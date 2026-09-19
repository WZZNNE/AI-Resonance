/**
 * Settings › Search, API part: one card per API engine (switch, credential from the vault, parameters, Test), the
 * "Custom JSON API" editor, and the credential row the reader section reuses. Keys never pass through here — only
 * credential ids chosen with the vault's `vault.pick`.
 */
import { useState } from 'preact/hooks'
import { hasCommand } from '../core/registry.ts'
import { type MessageKey, t } from '../i18n/index.ts'
import { Button } from '../ui/button.tsx'
import { Badge } from '../ui/chip.tsx'
import { Field, Input, Segmented, Select, Switch, Textarea } from '../ui/form.tsx'
import { Icon } from '../ui/icons.tsx'
import { ExtLink } from '../ui/link.tsx'
import { API_ENGINES, type ApiEngineSpec, CUSTOM_API_TEMPLATE } from './engines.ts'
import { describeSearchError } from './errors.ts'
import { type ApiEngineConfig, apiEngines, enabledApi, engineConfig, newId, searchPrefs } from './prefs.ts'
import { formatHeaderLines, parseHeaderLines, parsePathList, renderTemplate } from './template.ts'
import { credentialName, pickCredential, runEngine } from './web.ts'

const NOTES: Record<string, MessageKey> = {
  tavily: 'search.note.tavily',
  serper: 'search.note.serper',
  bocha: 'search.note.bocha',
  jina: 'search.note.jina',
  firecrawl: 'search.note.firecrawl',
  googlecse: 'search.note.googlecse',
  searxng: 'search.note.searxng',
  brave: 'search.note.brave',
  exa: 'search.note.exa',
  qianfan: 'search.note.qianfan',
  kagi: 'search.note.kagi',
}

const PARAMS: Record<string, MessageKey> = { cx: 'search.param.cx', baseUrl: 'search.param.baseUrl' }

/** Which credential a feature uses: pick/replace/remove through the vault. Shows its label, never the secret. */
export function CredentialRow({
  value,
  kind,
  optional,
  onValue,
}: {
  value: string
  kind: 'search' | 'reader'
  optional?: boolean
  onValue: (id: string) => void
}) {
  const vault = hasCommand('vault.pick')
  const name = value ? credentialName(value) : null
  const gone = !!value && vault && !name
  const status = value
    ? (name ?? (gone ? t('search.set.keyGone') : t('search.set.keySet')))
    : optional
      ? t('search.set.keyOptional')
      : t('search.set.keyMissing')
  return (
    <div class="sset-cred">
      <span class={`sset-cred__status${(value && !gone) || optional ? '' : ' is-missing'}`}>
        <Icon name="key" size={16} />
        {status}
      </span>
      <span class="sset-cred__actions">
        <Button
          size="s"
          icon="key"
          disabled={!vault}
          onClick={async () => {
            const id = await pickCredential(kind)
            if (id) onValue(id)
          }}
        >
          {value ? t('search.set.keyChange') : t('search.set.keyPick')}
        </Button>
        {value && (
          <Button size="s" variant="ghost" onClick={() => onValue('')}>
            {t('search.set.keyRemove')}
          </Button>
        )}
      </span>
      {!vault && <p class="settings__hint">{t('search.set.noVault')}</p>}
    </div>
  )
}

function TestButton({ spec }: { spec: ApiEngineSpec }) {
  const [state, setState] = useState<{ busy: boolean; text?: string; ok?: boolean }>({ busy: false })
  const run = async () => {
    setState({ busy: true })
    const r = await runEngine(spec, 'open source large language model', { count: 3 })
    if (!r.ok) return setState({ busy: false, ok: false, text: describeSearchError(r.error, spec.label) })
    const first = r.results[0]
    const head = t('search.set.testOk', { n: r.results.length, ms: r.ms, status: r.status })
    setState({ busy: false, ok: true, text: first ? `${head} — ${first.title} (${first.url})` : head })
  }
  return (
    <div class="sset-test__row">
      <Button size="s" icon="send" loading={state.busy} onClick={run}>
        {t('search.set.test')}
      </Button>
      {state.text && (
        <p class={`sset-test ${state.ok ? 'is-ok' : 'is-err'}`} role="status">
          {state.text}
        </p>
      )}
    </div>
  )
}

function ApiCard({ spec, custom, onEdit }: { spec: ApiEngineSpec; custom?: boolean; onEdit?: () => void }) {
  const p = searchPrefs.value
  const cfg = engineConfig(p, spec.id)
  const update = (patch: Partial<ApiEngineConfig>) =>
    searchPrefs.set((s) => ({ api: { ...s.api, [spec.id]: { ...engineConfig(s, spec.id), ...patch } } }))
  const note = NOTES[spec.id]
  return (
    <li class={`sset-api${cfg.enabled ? ' is-on' : ''}`}>
      <div class="sset-api__head">
        <span class="sset-api__title">{spec.label}</span>
        {spec.relay && (
          <Badge tone="warn" icon="lock">
            {t('search.set.relayOnly')}
          </Badge>
        )}
        {spec.legacy && <Badge tone="warn">{t('search.set.legacy')}</Badge>}
        {spec.auth === 'optional' && <Badge tone="ok">{t('search.set.keyless')}</Badge>}
        {custom && <Badge>{t('search.set.customBadge')}</Badge>}
        <Switch
          checked={cfg.enabled}
          label={t('search.set.enable', { name: spec.label })}
          onChange={(v) => update({ enabled: v })}
        />
      </div>
      {note && <p class="settings__hint">{t(note)}</p>}
      {cfg.enabled && spec.relay && p.relay === 'none' && <p class="sset-warn">{t('search.set.relayNeeded')}</p>}
      {cfg.enabled && (
        <div class="sset-api__body">
          {spec.auth !== 'none' && (
            <CredentialRow
              value={cfg.credentialId}
              kind="search"
              optional={spec.auth === 'optional'}
              onValue={(id) => update({ credentialId: id })}
            />
          )}
          {spec.params?.map((prm) => (
            <Field key={prm.name} label={PARAMS[prm.name] ? t(PARAMS[prm.name]) : prm.label}>
              {(id, describedBy) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  value={cfg.params[prm.name] ?? ''}
                  placeholder={prm.placeholder}
                  spellcheck={false}
                  onValue={(v) => update({ params: { ...cfg.params, [prm.name]: v.trim() } })}
                />
              )}
            </Field>
          ))}
          <div class="settings__row">
            <TestButton spec={spec} />
          </div>
        </div>
      )}
      <div class="sset-api__foot">
        {spec.docs && (
          <ExtLink href={spec.docs} arrow class="sset-link">
            {t('search.set.docs')}
          </ExtLink>
        )}
        {custom && onEdit && (
          <Button size="s" variant="ghost" icon="sliders" onClick={onEdit}>
            {t('search.set.edit')}
          </Button>
        )}
      </div>
    </li>
  )
}

interface Draft {
  label: string
  method: 'GET' | 'POST'
  url: string
  headers: string
  body: string
  auth: boolean
  relay: boolean
  results: string
  title: string
  link: string
  snippet: string
  date: string
  error: string
}

const list = (v: string | string[] | undefined) => (Array.isArray(v) ? v.join(', ') : (v ?? ''))
const paths = (text: string) => {
  const l = parsePathList(text)
  return l.length > 1 ? l : (l[0] ?? '')
}

function toDraft(s: ApiEngineSpec): Draft {
  return {
    label: s.label,
    method: s.request.method,
    url: s.request.url,
    headers: formatHeaderLines(s.request.headers),
    body: s.request.body ?? '',
    auth: s.auth !== 'none',
    relay: !!s.relay,
    results: s.response.results,
    title: list(s.response.title),
    link: list(s.response.url),
    snippet: list(s.response.snippet),
    date: list(s.response.date),
    error: list(s.response.error),
  }
}

/** Pure: the form → a spec, or the message key of the first problem. */
export function draftToSpec(d: Draft, id: string): ApiEngineSpec | MessageKey {
  if (!d.label.trim()) return 'search.set.errName'
  try {
    const u = new URL(renderTemplate(d.url, { query: 'test', key: 'k', count: 5, lang: 'en', params: {} }, 'url'))
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'search.set.errUrl'
  } catch {
    return 'search.set.errUrl'
  }
  if (!/\{\{\s*query\s*\}\}/.test(`${d.url} ${d.body}`)) return 'search.set.errQuery'
  if (d.method === 'POST' && d.body.trim()) {
    try {
      JSON.parse(renderTemplate(d.body, { query: 'q"x', key: 'k', count: 5, lang: 'en' }, 'json'))
    } catch {
      return 'search.set.errBody'
    }
  }
  if (!d.title.trim() || !d.link.trim()) return 'search.set.errPaths'
  const date = paths(d.date)
  const error = paths(d.error)
  return {
    id,
    label: d.label.trim(),
    request: {
      method: d.method,
      url: d.url.trim(),
      headers: parseHeaderLines(d.headers),
      ...(d.method === 'POST' && d.body.trim() ? { body: d.body.trim() } : {}),
    },
    auth: d.auth ? 'required' : 'none',
    response: {
      results: d.results.trim(),
      title: paths(d.title),
      url: paths(d.link),
      snippet: paths(d.snippet),
      ...(date ? { date } : {}),
      ...(error ? { error } : {}),
    },
    ...(d.relay ? { relay: true } : {}),
  }
}

function CustomApiForm({ spec, onDone }: { spec: ApiEngineSpec; onDone: () => void }) {
  const [d, setD] = useState<Draft>(() => toDraft(spec))
  const [err, setErr] = useState<MessageKey | null>(null)
  const set = (patch: Partial<Draft>) => setD({ ...d, ...patch })
  const isNew = !spec.id
  const save = () => {
    const p = searchPrefs.value
    const id =
      spec.id ||
      newId(
        'api',
        d.label,
        apiEngines(p).map((s) => s.id),
      )
    const next = draftToSpec(d, id)
    if (typeof next === 'string') return setErr(next)
    searchPrefs.set((s) => ({
      customApi: isNew ? [...s.customApi, next] : s.customApi.map((x) => (x.id === id ? next : x)),
      api: isNew ? { ...s.api, [id]: { enabled: true, credentialId: '', params: {} } } : s.api,
    }))
    onDone()
  }
  const remove = () => {
    searchPrefs.set((s) => {
      const { [spec.id]: _gone, ...api } = s.api
      return {
        customApi: s.customApi.filter((x) => x.id !== spec.id),
        api,
        active: s.active === spec.id ? '' : s.active,
      }
    })
    onDone()
  }
  const text = (key: keyof Draft, label: MessageKey, hint?: MessageKey, placeholder?: string) => (
    <Field label={t(label)} hint={hint ? t(hint) : undefined}>
      {(id, describedBy) => (
        <Input
          id={id}
          aria-describedby={describedBy}
          value={d[key] as string}
          placeholder={placeholder}
          spellcheck={false}
          onValue={(v) => set({ [key]: v } as Partial<Draft>)}
        />
      )}
    </Field>
  )
  return (
    <fieldset class="sset-form" aria-label={t(isNew ? 'search.set.customAdd' : 'search.set.customEdit')}>
      <h4 class="settings__subh">{t(isNew ? 'search.set.customAdd' : 'search.set.customEdit')}</h4>
      <p class="settings__hint">{t('search.set.customHint')}</p>
      {text('label', 'search.set.name')}
      <Field label={t('search.set.method')}>
        {(id, describedBy) => (
          <Segmented
            id={id}
            aria-describedby={describedBy}
            size="s"
            label={t('search.set.method')}
            value={d.method}
            onValue={(v) => set({ method: v })}
            options={[
              { value: 'GET', label: 'GET' },
              { value: 'POST', label: 'POST' },
            ]}
          />
        )}
      </Field>
      {text('url', 'search.set.url', 'search.set.urlHint', 'https://example.com/search?q={{query}}')}
      <Field label={t('search.set.headers')} hint={t('search.set.headersHint')}>
        {(id, describedBy) => (
          <Textarea
            id={id}
            aria-describedby={describedBy}
            code
            rows={3}
            value={d.headers}
            spellcheck={false}
            onValue={(v) => set({ headers: v })}
          />
        )}
      </Field>
      {d.method === 'POST' && (
        <Field label={t('search.set.body')} hint={t('search.set.bodyHint')}>
          {(id, describedBy) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              code
              rows={3}
              value={d.body}
              spellcheck={false}
              onValue={(v) => set({ body: v })}
            />
          )}
        </Field>
      )}
      <Field inline label={t('search.set.needsKey')}>
        {(id, describedBy) => (
          <Switch id={id} aria-describedby={describedBy} checked={d.auth} onChange={(v) => set({ auth: v })} />
        )}
      </Field>
      <Field inline label={t('search.set.viaRelay')}>
        {(id, describedBy) => (
          <Switch id={id} aria-describedby={describedBy} checked={d.relay} onChange={(v) => set({ relay: v })} />
        )}
      </Field>
      {text('results', 'search.set.results', 'search.set.resultsHint', 'data.items')}
      {text('title', 'search.set.pTitle', 'search.set.pathsHint', 'title')}
      {text('link', 'search.set.pUrl', undefined, 'url, link')}
      {text('snippet', 'search.set.pSnippet', undefined, 'snippet, content')}
      {text('date', 'search.set.pDate')}
      {text('error', 'search.set.pError')}
      {err && (
        <p class="sset-warn" role="alert">
          {t(err)}
        </p>
      )}
      <div class="settings__row">
        <Button variant="primary" size="s" icon="check" onClick={save}>
          {t('search.set.save')}
        </Button>
        <Button variant="ghost" size="s" onClick={onDone}>
          {t('ui.cancel')}
        </Button>
        {!isNew && (
          <Button variant="danger" size="s" icon="trash" onClick={remove}>
            {t('search.set.delete')}
          </Button>
        )}
      </div>
    </fieldset>
  )
}

/** The "In-page results" section: active engine, result count, every API engine and the custom editor. */
export function ApiSection() {
  const p = searchPrefs.value
  const [editing, setEditing] = useState<ApiEngineSpec | null>(null)
  const on = enabledApi(p)
  const direct = API_ENGINES.filter((s) => !s.relay)
  const relayed = API_ENGINES.filter((s) => s.relay)
  return (
    <section class="settings__group">
      <h3 class="settings__subh">{t('search.set.api')}</h3>
      <p class="settings__hint">{t('search.set.apiHint')}</p>
      {on.length > 1 && (
        <Field label={t('search.set.active')}>
          {(id, describedBy) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              value={p.active || on[0].id}
              onValue={(v) => searchPrefs.set({ active: v })}
              options={on.map((s) => ({ value: s.id, label: s.label }))}
            />
          )}
        </Field>
      )}
      <Field label={t('search.set.count')}>
        {(id, describedBy) => (
          <Select
            id={id}
            aria-describedby={describedBy}
            value={String(p.count)}
            onValue={(v) => searchPrefs.set({ count: Number(v) })}
            options={['3', '5', '8', '10'].map((v) => ({ value: v, label: v }))}
          />
        )}
      </Field>
      <ul class="sset-list">
        {direct.map((s) => (
          <ApiCard key={s.id} spec={s} />
        ))}
        {p.customApi.map((s) => (
          <ApiCard key={s.id} spec={s} custom onEdit={() => setEditing(s)} />
        ))}
      </ul>
      {editing ? (
        <CustomApiForm key={editing.id || 'new'} spec={editing} onDone={() => setEditing(null)} />
      ) : (
        <div class="settings__row">
          <Button size="s" icon="plus" onClick={() => setEditing(CUSTOM_API_TEMPLATE)}>
            {t('search.set.customAdd')}
          </Button>
        </div>
      )}
      <h4 class="settings__subh">{t('search.set.relayEngines')}</h4>
      <p class="settings__hint">{t('search.set.relayEnginesHint')}</p>
      <ul class="sset-list">
        {relayed.map((s) => (
          <ApiCard key={s.id} spec={s} />
        ))}
      </ul>
    </section>
  )
}
