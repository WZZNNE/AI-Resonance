/**
 * The one-click summary sheet (DESIGN §8.4): opens from ✦ on any item and streams a verdict card. Model switcher (sets
 * the active model), effort picker (clamped to the model), language (follows the UI, overridable per run), depth,
 * optional web grounding, estimated cost before and actual cost after, thinking indicator, stop / re-run / copy.
 * Results are cached per (item, language, model, depth); a cache hit shows instantly and re-running is explicit.
 */
import { signal } from '@preact/signals'
import type { Item, Lang } from '@resonance/schema'
import { render } from 'preact'
import { useEffect, useId, useMemo, useRef, useState } from 'preact/hooks'
import { toast } from '../core/events.ts'
import { hasCommand, runCommand } from '../core/registry.ts'
import { navigate } from '../core/router.ts'
import { boardMetas } from '../core/state.ts'
import { fmt, type MessageKey, t, lang as uiLang } from '../i18n/index.ts'
import { boardTitle, itemTitle } from '../items/text.ts'
import { Button } from '../ui/button.tsx'
import { Badge, Chip } from '../ui/chip.tsx'
import { Segmented, Select, Switch } from '../ui/form.tsx'
import { Icon } from '../ui/icons.tsx'
import { copyText } from '../ui/link.tsx'
import { Markdown } from '../ui/markdown.tsx'
import { Sheet } from '../ui/sheet.tsx'
import { EmptyState, Spinner } from '../ui/state.tsx'
import { type CachedSummary, getSummary } from './cache.ts'
import { runSummary } from './client.ts'
import type { ContextUse } from './context.ts'
import { clampEffort } from './effort.ts'
import { AiError } from './errors.ts'
import { aiErrorText, LocalHelp, usdText } from './help.tsx'
import { costUsd, estimateTokens, expectedOutputTokens } from './pricing.ts'
import { buildPrompt, type Verdict, visibleBody } from './prompt.ts'
import { findModel, modelKeyOf } from './providers.ts'
import { aiPrefs, loadPricing, modelInfo, patchProvider } from './store.ts'
import { type Depth, EFFORTS, type Effort, type Provider } from './types.ts'
import './ai.css'

const target = signal<{ item: Item; seq: number } | null>(null)
const open = signal(false)
let host: HTMLElement | null = null
let seq = 0

/** Open the sheet for `item` (the ✦ item action). */
export function openSummary(item: Item): void {
  if (!host) {
    host = document.createElement('div')
    host.setAttribute('data-part', 'summary-host')
    document.body.appendChild(host)
    render(<Host />, host)
  }
  target.value = { item, seq: ++seq }
  open.value = true
}

function Host() {
  const tg = target.value
  if (!tg) return null
  return <SummarySheet key={tg.seq} item={tg.item} open={open.value} onClose={() => (open.value = false)} />
}

type Phase = 'idle' | 'loading' | 'context' | 'streaming' | 'done' | 'stopped' | 'error'

interface RunState {
  phase: Phase
  text: string
  thinking: string
  used: ContextUse[]
  estimate?: { input: number; output: number }
  result?: CachedSummary
  cached?: boolean
  error?: AiError
}

const EMPTY: RunState = { phase: 'loading', text: '', thinking: '', used: [] }

const VERDICT_TONE: Record<Verdict, 'ok' | 'info' | 'neutral'> = { dig: 'ok', bookmark: 'info', skip: 'neutral' }

/** Rough size of fetched context before it is fetched, for the "before" estimate. */
const FETCH_GUESS: Record<Depth, number> = { brief: 1500, deep: 4000 }

function ContextList({ used }: { used: ContextUse[] }) {
  if (!used.length) return null
  return (
    <div class="aisum__used">
      <span class="kicker">{t('ai.contextUsed')}</span>
      <div class="aisum__chips">
        {used.map((u) => (
          <Chip
            key={u.id + (u.url ?? '')}
            size="s"
            tone={u.ok ? 'neutral' : 'warn'}
            icon={u.ok ? 'check' : 'x'}
            title={u.note ?? u.url}
          >
            {t(`ai.ctx.${u.id}` as MessageKey)}
          </Chip>
        ))}
      </div>
    </div>
  )
}

function SummarySheet({ item, open: isOpen, onClose }: { item: Item; open: boolean; onClose: () => void }) {
  const prefs = aiPrefs.value
  const providers = prefs.providers
  const [sel, setSel] = useState(() => {
    const f = findModel(providers, prefs.active)
    return f ? modelKeyOf(f.provider.id, f.model.id) : ''
  })
  const found = findModel(providers, sel)
  const [outLang, setOutLang] = useState<Lang>(prefs.lang || uiLang.value)
  const [depth, setDepth] = useState<Depth>(prefs.depth)
  const canWeb = hasCommand('search.web')
  const [web, setWeb] = useState(prefs.web)
  const webId = useId()
  const info = found ? modelInfo(found.provider, found.model) : null
  const [picked, setPicked] = useState<Effort | null>(null)
  const effort = clampEffort(picked ?? found?.model.effort ?? prefs.effort, info?.efforts)
  const [run, setRun] = useState<RunState>(EMPTY)
  const abort = useRef<AbortController | null>(null)
  const autoRan = useRef(false)
  const buf = useRef({ text: '', thinking: '', frame: 0 })

  useEffect(() => void loadPricing(), [])
  useEffect(() => () => abort.current?.abort(), [])
  useEffect(() => {
    if (!isOpen) abort.current?.abort()
  }, [isOpen])

  const flush = () => {
    buf.current.frame = 0
    const { text, thinking } = buf.current
    setRun((r) => ({ ...r, text, thinking }))
  }

  const start = async (providerOverride?: Provider) => {
    if (!found) return
    abort.current?.abort()
    const ac = new AbortController()
    abort.current = ac
    buf.current = { text: '', thinking: '', frame: 0 }
    setRun({ phase: 'context', text: '', thinking: '', used: [] })
    try {
      const entry = await runSummary(
        {
          item,
          provider: providerOverride ?? found.provider,
          model: found.model,
          lang: outLang,
          depth,
          effort,
          showThinking: prefs.showThinking,
          web: web && canWeb,
          aboutMe: prefs.aboutMe,
          price: info?.price ?? null,
          catalogMaxOut: info?.match?.price.maxOut,
          signal: ac.signal,
        },
        {
          onContext: (ctx, input, output) =>
            setRun((r) => ({ ...r, phase: 'streaming', used: ctx.used, estimate: { input, output } })),
          onEvent: (e) => {
            const b = buf.current
            if (e.type === 'text') b.text += e.text
            else if (e.type === 'thinking') b.thinking += e.text
            else if (e.type === 'reset') {
              b.text = ''
              b.thinking = ''
            } else return
            // One render per frame, not per token: Markdown re-parses the whole text each time.
            b.frame ||= requestAnimationFrame(flush)
          },
        },
      )
      if (abort.current !== ac) return
      cancelAnimationFrame(buf.current.frame)
      setRun((r) => ({
        ...r,
        phase: 'done',
        result: entry,
        cached: false,
        thinking: entry.thinking ?? '',
        used: entry.used ?? r.used,
      }))
    } catch (err) {
      if (abort.current !== ac) return
      cancelAnimationFrame(buf.current.frame)
      const e = err instanceof AiError ? err : new AiError('unknown', err instanceof Error ? err.message : String(err))
      const { text, thinking } = buf.current
      if (e.kind === 'aborted') setRun((r) => ({ ...r, text, thinking, phase: text ? 'stopped' : 'idle' }))
      // A declined answer's partial text must not read as if it were the card.
      else if (e.kind === 'refusal') setRun((r) => ({ ...r, text: '', thinking: '', phase: 'error', error: e }))
      else setRun((r) => ({ ...r, text, thinking, phase: 'error', error: e }))
    }
  }

  // Show the cached card for this (model, language, depth); auto-run only once, on open, when nothing is cached.
  useEffect(() => {
    if (!found) return setRun({ ...EMPTY, phase: 'idle' })
    abort.current?.abort()
    let alive = true
    setRun(EMPTY)
    getSummary(item.key, outLang, sel, depth).then((hit) => {
      if (!alive) return
      if (hit)
        setRun({
          phase: 'done',
          text: '',
          thinking: hit.thinking ?? '',
          used: hit.used ?? [],
          result: hit,
          cached: true,
        })
      else if (!autoRan.current && isOpen) {
        autoRan.current = true
        void start()
      } else setRun({ ...EMPTY, phase: 'idle' })
    })
    return () => {
      alive = false
    }
  }, [sel, outLang, depth, !!found])

  const preInput = useMemo(() => {
    const p = buildPrompt({ item, lang: outLang, depth, context: [], aboutMe: prefs.aboutMe })
    return estimateTokens(p.system) + estimateTokens(p.user) + FETCH_GUESS[depth]
  }, [item, outLang, depth, prefs.aboutMe])

  const busy = run.phase === 'context' || run.phase === 'streaming'
  const title = itemTitle(item, uiLang.value)

  if (!found) {
    return (
      <Sheet open={isOpen} onClose={onClose} title={t('ai.summaryTitle')} part="summary-sheet">
        <EmptyState
          icon="sparkle"
          title={t('ai.firstRun.title')}
          action={
            <Button
              variant="primary"
              icon="settings"
              onClick={() => {
                onClose()
                navigate('/settings/models')
              }}
            >
              {t('ai.firstRun.action')}
            </Button>
          }
        >
          <p>{t('ai.firstRun.body')}</p>
        </EmptyState>
      </Sheet>
    )
  }

  const { provider, model } = found
  const price = info?.price ?? null
  const options = providers.flatMap((p) =>
    p.models.map((m) => ({ value: modelKeyOf(p.id, m.id), label: `${m.name || m.id} · ${p.name}` })),
  )
  const allowed = info?.efforts
  const effortOptions = EFFORTS.filter((e) => e === 'default' || !allowed || allowed.includes(e)).map((e) => ({
    value: e,
    label: t(`ai.effort.${e}` as MessageKey),
  }))
  const shown = run.phase === 'done' && run.result ? run.result.markdown : visibleBody(run.text)
  const verdict = run.phase === 'done' ? run.result?.verdict : undefined

  const costLine = (() => {
    if (run.phase === 'done' && run.result) {
      const r = run.result
      const tokens = r.usage ? t('ai.tokens', { in: fmt.compact(r.usage.input), out: fmt.compact(r.usage.output) }) : ''
      if (price?.source === 'local') return [t('ai.priceLocal'), tokens].filter(Boolean).join(' · ')
      if (r.costUsd === undefined) return [t('ai.priceUnknown'), tokens].filter(Boolean).join(' · ')
      return [
        r.usage ? t('ai.costActual', { usd: usdText(r.costUsd) }) : t('ai.costEst', { usd: usdText(r.costUsd) }),
        tokens,
      ]
        .filter(Boolean)
        .join(' · ')
    }
    if (!price) return t('ai.priceUnknown')
    if (price.source === 'local') return t('ai.priceLocal')
    const est = run.estimate ?? {
      input: preInput,
      output: expectedOutputTokens(depth, effort, model.reasoning !== false),
    }
    return t('ai.costEst', { usd: usdText(costUsd({ input: est.input, output: est.output }, price)) })
  })()

  const copy = async () => {
    const body = run.result?.markdown ?? visibleBody(run.text)
    const head = verdict ? `**${t(`ai.verdict.${verdict}` as MessageKey)}**\n\n` : ''
    const ok = await copyText(`# ${title}\n\n${head}${body}\n\n${item.url}`)
    toast(t(ok ? 'ai.copied' : 'ai.copyFailed'), { kind: ok ? 'ok' : 'warn' })
  }

  const chooseKey = async () => {
    const id = await runCommand('vault.pick', { kind: 'llm' })
    if (id) {
      patchProvider(provider.id, { credentialId: id })
      void start({ ...provider, credentialId: id })
    }
  }

  const footer = (
    <div class="aisum__foot">
      {busy ? (
        <Button icon="x" onClick={() => abort.current?.abort()}>
          {t('ai.stop')}
        </Button>
      ) : (
        <Button variant="primary" icon={run.result || run.text ? 'refresh' : 'sparkle'} onClick={() => void start()}>
          {run.result || run.text ? t('ai.rerun') : t('ai.run')}
        </Button>
      )}
      <Button icon="copy" disabled={!shown} onClick={() => void copy()}>
        {t('ai.copy')}
      </Button>
      <span class="aisum__cost num" aria-live="polite">
        {costLine}
      </span>
    </div>
  )

  return (
    <Sheet open={isOpen} onClose={onClose} title={t('ai.summaryTitle')} part="summary-sheet" footer={footer}>
      <div class="aisum" style={{ '--hue': `var(--hue-${item.board})` }}>
        <p class="aisum__item">
          <span class="aisum__board">
            <span class="hue-dot" aria-hidden="true" />
            {boardTitle(item.board, boardMetas.value.get(item.board))}
          </span>
          <strong>{title}</strong>
        </p>

        {/* Run options: one grouped inset plate, a visible label per row (the controls keep their own names). */}
        <div class="aisum__controls">
          <div class="aisum__ctl">
            <span class="aisum__lbl" aria-hidden="true">
              {t('ai.model')}
            </span>
            <Select
              class="aisum__model"
              aria-label={t('ai.model')}
              value={sel}
              options={options}
              onValue={(v) => {
                setSel(v)
                setPicked(null)
                aiPrefs.set({ active: v })
              }}
            />
          </div>
          <div class="aisum__ctl aisum__ctl--stack">
            <span class="aisum__lbl" aria-hidden="true">
              {t('ai.effort')}
            </span>
            <div class="aisum__scroll">
              <Segmented size="s" label={t('ai.effort')} value={effort} options={effortOptions} onValue={setPicked} />
            </div>
          </div>
          <div class="aisum__ctl">
            <span class="aisum__lbl" aria-hidden="true">
              {t('ai.depth')}
            </span>
            <Segmented
              size="s"
              label={t('ai.depth')}
              value={depth}
              onValue={setDepth}
              options={[
                { value: 'brief', label: t('ai.depth.brief') },
                { value: 'deep', label: t('ai.depth.deep') },
              ]}
            />
          </div>
          <div class="aisum__ctl">
            <span class="aisum__lbl" aria-hidden="true">
              {t('ai.language')}
            </span>
            <Segmented
              size="s"
              label={t('ai.language')}
              value={outLang}
              onValue={setOutLang}
              options={[
                { value: 'en', label: 'EN' },
                { value: 'zh', label: '中文' },
              ]}
            />
          </div>
          {canWeb && (
            <div class="aisum__ctl">
              <label class="aisum__lbl" for={webId}>
                {t('ai.web')}
              </label>
              <Switch id={webId} checked={web} onChange={setWeb} />
            </div>
          )}
        </div>

        {/* The verdict card: the AI-written text carries the signal edge, like the Brief. */}
        <article class="aisum__card signal-edge" aria-busy={busy}>
          {verdict && (
            <p class="aisum__verdict">
              <Badge tone={VERDICT_TONE[verdict]} class={`aisum__chip is-${verdict}`}>
                {t(`ai.verdict.${verdict}` as MessageKey)}
              </Badge>
              {run.cached && run.result && (
                <span class="aisum__meta">{t('ai.cachedAt', { when: fmt.relative(run.result.at) })}</span>
              )}
              {run.result?.servedBy && (
                <span class="aisum__meta">{t('ai.servedBy', { model: run.result.servedBy })}</span>
              )}
            </p>
          )}

          {(run.phase === 'loading' || run.phase === 'context' || (run.phase === 'streaming' && !shown)) && (
            <p class="aisum__status" role="status">
              <Spinner size={14} />
              {run.phase === 'context'
                ? t('ai.gathering')
                : run.phase === 'streaming'
                  ? t('ai.thinking')
                  : t('ai.loading')}
            </p>
          )}

          {run.thinking && prefs.showThinking && (
            <details class="aisum__thinking" open={busy && !shown}>
              <summary>
                <Icon name="chevron-down" size={14} class="aisum__chev" />
                {t('ai.thinkingShown')}
              </summary>
              <p>{run.thinking}</p>
            </details>
          )}

          {shown && <Markdown text={shown} headingBase={4} class="aisum__md" />}
          {run.phase === 'stopped' && <p class="aisum__meta">{t('ai.stopped')}</p>}

          {run.phase === 'idle' && !shown && (
            <p class="aisum__meta aisum__idle">{t('ai.idle', { model: model.name || model.id })}</p>
          )}
        </article>

        {run.phase === 'error' && run.error && (
          <div class="aisum__error" role="alert">
            <p>
              <strong>
                {aiErrorText(run.error, { baseUrl: provider.baseUrl, provider: provider.name, model: model.id })}
              </strong>
            </p>
            {run.error.message && run.error.kind !== 'no-key' && <p class="aisum__meta">{run.error.message}</p>}
            {run.error.kind === 'local' && <LocalHelp />}
            <div class="settings__row">
              {run.error.kind === 'no-key' && (
                <Button icon="key" variant="primary" onClick={() => void chooseKey()}>
                  {t('ai.chooseKey')}
                </Button>
              )}
              {(run.error.kind === 'auth' || run.error.kind === 'forbidden') && (
                <Button
                  icon="key"
                  onClick={() => {
                    onClose()
                    navigate('/settings/credentials')
                  }}
                >
                  {t('ai.openCredentials')}
                </Button>
              )}
              {(run.error.kind === 'not-found' || run.error.kind === 'bad-request' || run.error.kind === 'cors') && (
                <Button
                  icon="settings"
                  onClick={() => {
                    onClose()
                    navigate('/settings/models')
                  }}
                >
                  {t('ai.openModels')}
                </Button>
              )}
            </div>
          </div>
        )}

        <ContextList used={run.used} />
      </div>
    </Sheet>
  )
}
