/**
 * Settings › Models — the lightweight model manager (DESIGN §8.1–8.3): summary defaults, providers from presets or
 * custom, a vault credential per provider, test connection / fetch models, and per model: display name, price (matched
 * from pricing.json with its confidence, or overridden), context size, allowed effort levels and default effort.
 * Local servers get a troubleshooting checklist. Everything stacks on phones.
 */
import { useEffect, useState } from 'preact/hooks'
import { toast } from '../core/events.ts'
import { hasCommand, runCommand } from '../core/registry.ts'
import { fmt, type MessageKey, t } from '../i18n/index.ts'
import { Button, IconButton } from '../ui/button.tsx'
import { Badge, Chip } from '../ui/chip.tsx'
import { Field, Input, Segmented, Select, Switch, Textarea } from '../ui/form.tsx'
import { Icon } from '../ui/icons.tsx'
import { ExtLink } from '../ui/link.tsx'
import { Dialog, Sheet } from '../ui/sheet.tsx'
import { EmptyState } from '../ui/state.tsx'
import { clearSummaries } from './cache.ts'
import { isKeyless, listModels } from './client.ts'
import { SCALE } from './effort.ts'
import { AiError, isLocalUrl } from './errors.ts'
import { aiErrorText, LocalHelp, priceText } from './help.tsx'
import { findModel, fromPreset, modelKeyOf, PRESETS, presetOf } from './providers.ts'
import {
  addModels,
  addProvider,
  aiPrefs,
  loadPricing,
  modelInfo,
  patchModel,
  patchProvider,
  pricing,
  removeModel,
  removeProvider,
} from './store.ts'
import { EFFORT_STYLES, EFFORTS, type Effort, type ModelRef, type Provider, type RemoteModel } from './types.ts'
import './ai.css'

const effortLabel = (e: Effort) => t(`ai.effort.${e}` as MessageKey)

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url || '—'
  }
}

/** A JSON object editor that only commits valid objects (on blur). */
function JsonField({
  label,
  hint,
  value,
  onCommit,
}: {
  label: string
  hint: string
  value: object | undefined
  onCommit: (v: Record<string, unknown> | undefined) => void
}) {
  const [draft, setDraft] = useState(value ? JSON.stringify(value, null, 2) : '')
  const [error, setError] = useState('')
  const commit = () => {
    if (!draft.trim()) {
      setError('')
      return onCommit(undefined)
    }
    try {
      const v = JSON.parse(draft)
      if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error('not an object')
      setError('')
      onCommit(v)
    } catch {
      setError(t('ai.jsonInvalid'))
    }
  }
  return (
    <Field label={label} hint={hint} error={error || undefined}>
      {(id, d) => (
        <Textarea
          id={id}
          aria-describedby={d}
          value={draft}
          onValue={setDraft}
          onBlur={commit}
          rows={3}
          code
          spellcheck={false}
        />
      )}
    </Field>
  )
}

/** A number field that keeps its own draft (so "0." survives typing) and commits on blur; empty commits `undefined`. */
function NumField({
  label,
  hint,
  value,
  placeholder,
  onCommit,
}: {
  label: string
  hint?: string
  value: number | undefined
  placeholder?: number
  onCommit: (v: number | undefined) => void
}) {
  const [draft, setDraft] = useState(value === undefined ? '' : String(value))
  useEffect(() => setDraft(value === undefined ? '' : String(value)), [value])
  const commit = () => {
    const n = Number(draft)
    if (!draft.trim()) onCommit(undefined)
    else if (Number.isFinite(n) && n >= 0) onCommit(n)
    else setDraft(value === undefined ? '' : String(value))
  }
  return (
    <Field label={label} hint={hint}>
      {(id, d) => (
        <Input
          id={id}
          aria-describedby={d}
          type="text"
          inputMode="decimal"
          value={draft}
          onValue={setDraft}
          onBlur={commit}
          placeholder={placeholder === undefined ? '—' : String(placeholder)}
        />
      )}
    </Field>
  )
}

function ModelRow({ p, m, active }: { p: Provider; m: ModelRef; active: boolean }) {
  const info = modelInfo(p, m)
  const [open, setOpen] = useState(false)
  const allowed = info.efforts
  const toggleEffort = (e: Effort) => {
    const base = allowed ?? []
    const next = base.includes(e) ? base.filter((x) => x !== e) : SCALE.filter((x) => x === e || base.includes(x))
    patchModel(p.id, m.id, { efforts: next })
  }
  const match = info.match
  return (
    <li class={`aimodel${active ? ' is-active' : ''}`}>
      <div class="aimodel__head">
        <button
          type="button"
          class="aimodel__pick"
          aria-pressed={active}
          aria-label={t('ai.makeActive', { model: m.name || m.id })}
          onClick={() => aiPrefs.set({ active: modelKeyOf(p.id, m.id) })}
        >
          <span class="aimodel__dot" aria-hidden="true" />
        </button>
        <div class="aimodel__text">
          <strong>{m.name || m.id}</strong>
          <span class="aimodel__meta">
            {m.name && <code>{m.id}</code>}
            <span class="num">{priceText(info.price)}</span>
            {info.price?.source === 'override' && <Badge tone="accent">{t('ai.priceOverride')}</Badge>}
            {info.price?.confidence && info.price.confidence !== 'exact' && (
              <Badge
                tone="warn"
                title={t('ai.priceFrom', { provider: info.price.provider ?? '', upd: info.price.upd ?? '' })}
              >
                {t(`ai.conf.${info.price.confidence}` as MessageKey)}
              </Badge>
            )}
            {(m.ctx ?? match?.price.ctx) && (
              <span>{t('ai.ctxTokens', { n: fmt.compact(m.ctx ?? match?.price.ctx ?? 0) })}</span>
            )}
          </span>
        </div>
        <IconButton
          size="s"
          icon={open ? 'chevron-up' : 'chevron-down'}
          label={t('ai.modelDetails', { model: m.id })}
          pressed={open}
          onClick={() => setOpen(!open)}
        />
      </div>
      {open && (
        <div class="aimodel__body">
          <Field label={t('ai.displayName')}>
            {(id) => (
              <Input id={id} value={m.name ?? ''} onValue={(v) => patchModel(p.id, m.id, { name: v || undefined })} />
            )}
          </Field>
          <div class="aimodel__grid">
            <NumField
              label={t('ai.priceIn')}
              hint={match ? t('ai.priceFrom', { provider: match.price.p, upd: match.price.upd ?? '' }) : undefined}
              value={m.price?.in}
              placeholder={match?.price.in}
              onCommit={(v) =>
                patchModel(p.id, m.id, {
                  price: v === undefined ? undefined : { in: v, out: m.price?.out ?? match?.price.out ?? 0 },
                })
              }
            />
            <NumField
              label={t('ai.priceOut')}
              value={m.price?.out}
              placeholder={match?.price.out}
              onCommit={(v) =>
                patchModel(p.id, m.id, {
                  price: v === undefined ? undefined : { in: m.price?.in ?? match?.price.in ?? 0, out: v },
                })
              }
            />
            <NumField
              label={t('ai.ctx')}
              value={m.ctx}
              placeholder={match?.price.ctx}
              onCommit={(v) => patchModel(p.id, m.id, { ctx: v || undefined })}
            />
          </div>
          <Field inline label={t('ai.reasoning')}>
            {(id) => (
              <Switch
                id={id}
                checked={m.reasoning ?? match?.price.reasoning ?? false}
                onChange={(v) => patchModel(p.id, m.id, { reasoning: v })}
              />
            )}
          </Field>
          <fieldset class="field aifieldset">
            <legend class="field__label">{t('ai.efforts')}</legend>
            <p class="field__hint">
              {allowed ? (m.efforts ? t('ai.effortsCustom') : t('ai.effortsCatalog')) : t('ai.effortsUnknown')}
            </p>
            <div class="aimodel__chips">
              {SCALE.map((e) => (
                <Chip key={e} size="s" selected={!!allowed?.includes(e)} onClick={() => toggleEffort(e)}>
                  {effortLabel(e)}
                </Chip>
              ))}
            </div>
          </fieldset>
          <Field label={t('ai.defaultEffort')}>
            {(id) => (
              <Select
                id={id}
                value={m.effort ?? 'default'}
                onValue={(v) => patchModel(p.id, m.id, { effort: v === 'default' ? undefined : v })}
                options={EFFORTS.filter((e) => e === 'default' || !allowed || allowed.includes(e)).map((e) => ({
                  value: e,
                  label: effortLabel(e),
                }))}
              />
            )}
          </Field>
          {p.kind === 'anthropic' && (
            <Field inline label={t('ai.fallback')} hint={t('ai.fallbackHint')}>
              {(id, d) => (
                <Switch
                  id={id}
                  aria-describedby={d}
                  checked={!!m.fallback}
                  onChange={(v) => patchModel(p.id, m.id, { fallback: v })}
                />
              )}
            </Field>
          )}
          <div class="settings__row">
            <Button size="s" variant="danger" icon="trash" onClick={() => removeModel(p.id, m.id)}>
              {t('ai.removeModel')}
            </Button>
          </div>
        </div>
      )}
    </li>
  )
}

function Credential({ p }: { p: Provider }) {
  const list = hasCommand('vault.list') ? (runCommand('vault.list', { kind: 'llm' }) ?? []) : []
  const current = p.credentialId ? (runCommand('vault.list') ?? []).find((c) => c.id === p.credentialId) : undefined
  const keyless = isKeyless(p)
  const pick = async () => {
    const id = await runCommand('vault.pick', { kind: 'llm' })
    if (id) patchProvider(p.id, { credentialId: id })
  }
  const state = current ? 'is-set' : p.credentialId ? 'is-missing' : keyless ? 'is-keyless' : 'is-none'
  return (
    <div class="field">
      <span class="field__label">{t('ai.credential')}</span>
      <div class={`aikey ${state}`}>
        <span class="aikey__disc" aria-hidden="true">
          <Icon name={current || keyless ? 'key' : 'lock'} size={16} />
        </span>
        <p class="aikey__text">
          {current ? (
            <>
              <span class="aikey__label">{current.label}</span>
              <code class="aikey__mask">{current.hint ?? t('ai.keyLocked')}</code>
            </>
          ) : p.credentialId ? (
            t('ai.keyMissing')
          ) : keyless ? (
            t('ai.keyless')
          ) : (
            t('ai.noKey')
          )}
        </p>
        <div class="aikey__actions">
          <Button size="s" icon="key" disabled={!hasCommand('vault.pick')} onClick={() => void pick()}>
            {list.length || current ? t('ai.chooseKey') : t('ai.addKey')}
          </Button>
          {p.credentialId && (
            <Button size="s" variant="ghost" onClick={() => patchProvider(p.id, { credentialId: undefined })}>
              {t('ai.unlinkKey')}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function ProviderCard({ p, activeKey }: { p: Provider; activeKey: string }) {
  const preset = presetOf(p.preset)
  const [status, setStatus] = useState<{ busy?: boolean; ok?: string; error?: AiError } | null>(null)
  const [remote, setRemote] = useState<RemoteModel[] | null>(null)
  const [filter, setFilter] = useState('')
  const [newId, setNewId] = useState('')
  const [confirm, setConfirm] = useState(false)
  const local = isLocalUrl(p.baseUrl)

  const fetchModels = async (keep: boolean) => {
    setStatus({ busy: true })
    try {
      const list = await listModels(p)
      setStatus({ ok: t('ai.testOk', { n: list.length }) })
      if (keep) setRemote(list)
    } catch (err) {
      setStatus({ error: err instanceof AiError ? err : new AiError('unknown', String(err)) })
    }
  }
  const have = new Set(p.models.map((m) => m.id))
  const shown = (remote ?? [])
    .filter((r) => !have.has(r.id) && r.id.toLowerCase().includes(filter.toLowerCase()))
    .slice(0, 60)

  return (
    <details class="aiprov" open={!p.models.length}>
      <summary class="aiprov__head">
        <span class="aiprov__mono" aria-hidden="true">
          {(p.name.trim()[0] ?? '?').toUpperCase()}
        </span>
        <span class="aiprov__text">
          <strong>{p.name}</strong>
          <span class="aiprov__meta">
            <span class="aiprov__host">{hostOf(p.baseUrl)}</span>
            <span>{t('ai.modelCount', { n: p.models.length })}</span>
            {local && <Badge tone="info">{t('ai.local')}</Badge>}
          </span>
        </span>
        <Icon name="chevron-down" size={16} class="aiprov__chev" />
      </summary>
      <div class="aiprov__body">
        {preset?.note && <p class="settings__hint">{t(preset.note)}</p>}
        {(preset?.docsUrl || preset?.keyUrl) && (
          <p class="aiprov__links">
            {preset.docsUrl && (
              <ExtLink href={preset.docsUrl} arrow>
                {t('ai.docs')}
              </ExtLink>
            )}
            {preset.keyUrl && (
              <ExtLink href={preset.keyUrl} arrow>
                {t('ai.getKey')}
              </ExtLink>
            )}
          </p>
        )}
        <div class="aimodel__grid">
          <Field label={t('ai.providerName')}>
            {(id) => <Input id={id} value={p.name} onValue={(v) => patchProvider(p.id, { name: v })} />}
          </Field>
          <Field label={t('ai.baseUrl')}>
            {(id) => (
              <Input
                id={id}
                type="url"
                value={p.baseUrl}
                onValue={(v) => patchProvider(p.id, { baseUrl: v.trim() })}
                spellcheck={false}
                icon="globe"
              />
            )}
          </Field>
        </div>
        <Credential p={p} />
        {local && <LocalHelp />}
        <div class="settings__row">
          <Button size="s" icon="check" loading={status?.busy} onClick={() => void fetchModels(false)}>
            {t('ai.test')}
          </Button>
          <Button size="s" icon="download" loading={status?.busy} onClick={() => void fetchModels(true)}>
            {t('ai.fetchModels')}
          </Button>
        </div>
        {status?.ok && (
          <p class="aiprov__ok" role="status">
            {status.ok}
          </p>
        )}
        {status?.error && (
          <div class="aisum__error" role="alert">
            <p>
              <strong>
                {/* A 404 on GET /models means "no listing here", not an unknown model. */}
                {status.error.kind === 'not-found'
                  ? t('ai.err.noList')
                  : aiErrorText(status.error, { baseUrl: p.baseUrl, provider: p.name })}
              </strong>
            </p>
            {status.error.message && <p class="aisum__meta">{status.error.message}</p>}
          </div>
        )}
        {remote && (
          <div class="airemote">
            <Input
              value={filter}
              onValue={setFilter}
              type="search"
              icon="search"
              placeholder={t('ai.filterModels')}
              aria-label={t('ai.filterModels')}
            />
            {shown.length ? (
              <ul class="airemote__list">
                {shown.map((r) => (
                  <li key={r.id}>
                    <code>{r.id}</code>
                    <IconButton
                      size="s"
                      icon="plus"
                      label={t('ai.addModelId', { model: r.id })}
                      onClick={() => addModels(p.id, [{ id: r.id, name: r.name, ctx: r.ctx, efforts: r.efforts }])}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p class="settings__hint">{t('ai.noMoreModels')}</p>
            )}
          </div>
        )}
        {p.models.length ? (
          <ul class="aimodels" aria-label={t('ai.models')}>
            {p.models.map((m) => (
              <ModelRow key={m.id} p={p} m={m} active={activeKey === modelKeyOf(p.id, m.id)} />
            ))}
          </ul>
        ) : (
          <p class="settings__hint">{t('ai.noModels')}</p>
        )}
        <form
          class="aiprov__add"
          onSubmit={(e) => {
            e.preventDefault()
            if (addModels(p.id, [{ id: newId.trim() }])) setNewId('')
          }}
        >
          <Input
            value={newId}
            onValue={setNewId}
            placeholder={t('ai.modelIdPlaceholder')}
            aria-label={t('ai.addModel')}
            spellcheck={false}
          />
          <Button type="submit" size="s" icon="plus" disabled={!newId.trim()}>
            {t('ai.addModel')}
          </Button>
        </form>
        <details class="aiprov__adv">
          <summary>{t('ai.advanced')}</summary>
          <div class="aiprov__body">
            <Field label={t('ai.effortStyle')} hint={t('ai.effortStyleHint')}>
              {(id, d) => (
                <Select
                  id={id}
                  aria-describedby={d}
                  value={p.effortStyle}
                  onValue={(v) => patchProvider(p.id, { effortStyle: v })}
                  options={EFFORT_STYLES.map((s) => ({ value: s, label: s }))}
                />
              )}
            </Field>
            {p.kind === 'openai' && (
              <>
                <Field label={t('ai.maxTokensField')}>
                  {(id) => (
                    <Select
                      id={id}
                      value={p.maxTokensField ?? 'max_tokens'}
                      onValue={(v) => patchProvider(p.id, { maxTokensField: v })}
                      options={[
                        { value: 'max_tokens', label: 'max_tokens' },
                        { value: 'max_completion_tokens', label: 'max_completion_tokens' },
                      ]}
                    />
                  )}
                </Field>
                <Field inline label={t('ai.includeUsage')} hint={t('ai.includeUsageHint')}>
                  {(id, d) => (
                    <Switch
                      id={id}
                      aria-describedby={d}
                      checked={p.includeUsage !== false}
                      onChange={(v) => patchProvider(p.id, { includeUsage: v })}
                    />
                  )}
                </Field>
              </>
            )}
            <JsonField
              label={t('ai.extraHeaders')}
              hint={t('ai.extraHeadersHint')}
              value={p.extraHeaders}
              onCommit={(v) => patchProvider(p.id, { extraHeaders: v as Record<string, string> | undefined })}
            />
            <JsonField
              label={t('ai.extraBody')}
              hint={t('ai.extraBodyHint')}
              value={p.extraBody}
              onCommit={(v) => patchProvider(p.id, { extraBody: v })}
            />
          </div>
        </details>
        <div class="settings__row">
          <Button size="s" variant="danger" icon="trash" onClick={() => setConfirm(true)}>
            {t('ai.removeProvider')}
          </Button>
        </div>
      </div>
      <Dialog
        open={confirm}
        alert
        onClose={() => setConfirm(false)}
        title={t('ai.removeProviderTitle', { name: p.name })}
        actions={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              {t('ui.cancel')}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                removeProvider(p.id)
                setConfirm(false)
              }}
            >
              {t('ai.remove')}
            </Button>
          </>
        }
      >
        <p>{t('ai.removeProviderBody')}</p>
      </Dialog>
    </details>
  )
}

function PresetSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title={t('ai.addProvider')} size="m" part="preset-sheet">
      <ul class="aipresets">
        {PRESETS.map((pr) => (
          <li key={pr.id}>
            <button
              type="button"
              class="tile aipresets__item"
              onClick={() => {
                const p = fromPreset(pr, aiPrefs.value.providers)
                addProvider(p)
                onClose()
                toast(t('ai.providerAdded', { name: p.name }), { kind: 'ok' })
              }}
            >
              <strong>{pr.template.name}</strong>
              <span>{pr.template.baseUrl ? hostOf(pr.template.baseUrl) : t('ai.customHint')}</span>
              {pr.keyless && <Badge tone="info">{t('ai.local')}</Badge>}
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  )
}

/** The Models tab. */
export default function ModelsTab() {
  const s = aiPrefs.value
  const [adding, setAdding] = useState(false)
  const active = findModel(s.providers, s.active)
  const activeKey = active ? modelKeyOf(active.provider.id, active.model.id) : ''
  const file = pricing.value
  useEffect(() => void loadPricing(), [])
  const options = s.providers.flatMap((p) =>
    p.models.map((m) => ({ value: modelKeyOf(p.id, m.id), label: `${m.name || m.id} · ${p.name}` })),
  )

  return (
    <div class="settings__stack ai">
      <section class="settings__group" aria-labelledby="ai-defaults">
        <h3 class="settings__subh" id="ai-defaults">
          {t('ai.defaults')}
        </h3>
        <p class="settings__hint">{t('ai.defaultsHint')}</p>
        {options.length > 0 && (
          <Field label={t('ai.activeModel')}>
            {(id) => <Select id={id} value={activeKey} options={options} onValue={(v) => aiPrefs.set({ active: v })} />}
          </Field>
        )}
        <Field label={t('ai.defaultEffort')} hint={t('ai.effortHint')}>
          {(id, d) => (
            <Select
              id={id}
              aria-describedby={d}
              value={s.effort}
              onValue={(v) => aiPrefs.set({ effort: v })}
              options={EFFORTS.map((e) => ({ value: e, label: effortLabel(e) }))}
            />
          )}
        </Field>
        <Field label={t('ai.language')} hint={t('ai.languageHint')}>
          {(id, d) => (
            <Segmented
              id={id}
              aria-describedby={d}
              label={t('ai.language')}
              value={s.lang || 'ui'}
              onValue={(v) => aiPrefs.set({ lang: v === 'ui' ? '' : v })}
              options={[
                { value: 'ui', label: t('ai.langFollow') },
                { value: 'en', label: 'English' },
                { value: 'zh', label: '中文' },
              ]}
            />
          )}
        </Field>
        <Field label={t('ai.depth')} hint={t('ai.depthHint')}>
          {(id, d) => (
            <Segmented
              id={id}
              aria-describedby={d}
              label={t('ai.depth')}
              value={s.depth}
              onValue={(v) => aiPrefs.set({ depth: v })}
              options={[
                { value: 'brief', label: t('ai.depth.brief') },
                { value: 'deep', label: t('ai.depth.deep') },
              ]}
            />
          )}
        </Field>
        <Field inline label={t('ai.showThinking')} hint={t('ai.showThinkingHint')}>
          {(id, d) => (
            <Switch
              id={id}
              aria-describedby={d}
              checked={s.showThinking}
              onChange={(v) => aiPrefs.set({ showThinking: v })}
            />
          )}
        </Field>
        {hasCommand('search.web') && (
          <Field inline label={t('ai.web')} hint={t('ai.webHint')}>
            {(id, d) => (
              <Switch id={id} aria-describedby={d} checked={s.web} onChange={(v) => aiPrefs.set({ web: v })} />
            )}
          </Field>
        )}
        <Field label={t('ai.aboutMe')} hint={t('ai.aboutMeHint')}>
          {(id, d) => (
            <Textarea
              id={id}
              aria-describedby={d}
              value={s.aboutMe}
              onValue={(v) => aiPrefs.set({ aboutMe: v })}
              rows={3}
              placeholder={t('ai.aboutMePlaceholder')}
            />
          )}
        </Field>
      </section>

      <section class="settings__group" aria-labelledby="ai-providers">
        <h3 class="settings__subh" id="ai-providers">
          {t('ai.providers')}
        </h3>
        <p class="settings__hint">{t('ai.providersHint')}</p>
        {s.providers.length ? (
          <div class="aiprovs">
            {s.providers.map((p) => (
              <ProviderCard key={p.id} p={p} activeKey={activeKey} />
            ))}
          </div>
        ) : (
          <EmptyState icon="sparkle" title={t('ai.firstRun.title')} compact>
            <p>{t('ai.firstRun.body')}</p>
          </EmptyState>
        )}
        <div class="settings__row">
          <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>
            {t('ai.addProvider')}
          </Button>
        </div>
      </section>

      <section class="settings__group" aria-labelledby="ai-pricing">
        <h3 class="settings__subh" id="ai-pricing">
          {t('ai.pricing')}
        </h3>
        <p class="settings__hint">
          {file
            ? t('ai.pricingFrom', { date: fmt.dateTime(file.updatedAt), n: file.models.length })
            : file === null
              ? t('ai.pricingMissing')
              : t('ai.loading')}
        </p>
        <div class="settings__row">
          <Button
            size="s"
            icon="trash"
            onClick={async () => {
              await clearSummaries()
              toast(t('ai.summariesCleared'), { kind: 'ok' })
            }}
          >
            {t('ai.clearSummaries')}
          </Button>
        </div>
      </section>

      <PresetSheet open={adding} onClose={() => setAdding(false)} />
    </div>
  )
}
