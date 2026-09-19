/**
 * Settings › Search: default web engine (language-based until the user picks one), which engines show under "More",
 * the user's own search sites, API engines for in-page results (apicfg.tsx), the page reader and the CORS relay.
 */
import { useState } from 'preact/hooks'
import { lang, type MessageKey, t } from '../i18n/index.ts'
import { Button, IconButton } from '../ui/button.tsx'
import { Field, Input, Segmented, Select, Switch, Textarea } from '../ui/form.tsx'
import { ApiSection, CredentialRow } from './apicfg.tsx'
import {
  checkRedirectTemplate,
  FIXED_ROW,
  languageDefault,
  READERS,
  REDIRECT_ENGINES,
  type ReaderId,
  type ReaderSpec,
  redirectUrl,
} from './engines.ts'
import { describeSearchError } from './errors.ts'
import { newId, readerSpec, redirectEngines, searchPrefs } from './prefs.ts'
import type { RelayMode } from './runner.ts'
import { formatHeaderLines, parseHeaderLines } from './template.ts'
import { runReaderSpec } from './web.ts'
import './search.css'

function DefaultEngine() {
  const p = searchPrefs.value
  const auto = REDIRECT_ENGINES.find((e) => e.id === languageDefault(lang.value))?.label ?? ''
  const choices = redirectEngines(p).filter((e) => e.group !== 'context')
  return (
    <section class="settings__group">
      <Field label={t('search.set.default')} hint={t('search.set.defaultHint')}>
        {(id, describedBy) => (
          <Select
            id={id}
            aria-describedby={describedBy}
            value={choices.some((e) => e.id === p.engine) ? p.engine : ''}
            onValue={(v) => searchPrefs.set({ engine: v })}
            options={[
              { value: '', label: t('search.set.auto', { engine: auto }) },
              ...choices.map((e) => ({ value: e.id, label: e.label })),
            ]}
          />
        )}
      </Field>
      <p class="settings__hint">{t('search.set.fixedRow')}</p>
    </section>
  )
}

function MoreEngines() {
  const p = searchPrefs.value
  const list = redirectEngines(p).filter((e) => !FIXED_ROW.includes(e.id))
  const toggle = (id: string, on: boolean) =>
    searchPrefs.set((s) => ({ hidden: on ? s.hidden.filter((x) => x !== id) : [...s.hidden, id] }))
  const remove = (id: string) =>
    searchPrefs.set((s) => ({
      custom: s.custom.filter((c) => c.id !== id),
      hidden: s.hidden.filter((x) => x !== id),
      engine: s.engine === id ? '' : s.engine,
    }))
  return (
    <section class="settings__group">
      <h3 class="settings__subh">{t('search.set.more')}</h3>
      <p class="settings__hint">{t('search.set.moreHint')}</p>
      <ul class="sset-list">
        {list.map((e) => (
          <li key={e.id} class="sset-engine">
            <span class="sset-engine__name">
              <strong>{e.label}</strong>
              {e.group === 'custom' && <span class="sset-code">{e.url}</span>}
            </span>
            {e.group === 'custom' && (
              <IconButton
                size="s"
                icon="trash"
                label={t('search.set.deleteNamed', { name: e.label })}
                onClick={() => remove(e.id)}
              />
            )}
            <Switch
              checked={!p.hidden.includes(e.id)}
              label={t('search.set.show', { name: e.label })}
              onChange={(on) => toggle(e.id, on)}
            />
          </li>
        ))}
      </ul>
      <AddSite />
    </section>
  )
}

function AddSite() {
  const [label, setLabel] = useState('')
  const [url, setUrl] = useState('')
  const [tried, setTried] = useState(false)
  const check = checkRedirectTemplate(url)
  const error = !tried
    ? undefined
    : !label.trim()
      ? t('search.set.errName')
      : check === 'no-query'
        ? t('search.set.errQuery')
        : check === 'bad-url'
          ? t('search.set.errUrl')
          : undefined
  const add = () => {
    setTried(true)
    if (!label.trim() || check !== 'ok') return
    searchPrefs.set((s) => {
      const id = newId(
        'site',
        label,
        redirectEngines(s).map((e) => e.id),
      )
      return { custom: [...s.custom, { id, label: label.trim(), url: url.trim(), group: 'custom' as const }] }
    })
    setLabel('')
    setUrl('')
    setTried(false)
  }
  return (
    <fieldset class="sset-form" aria-label={t('search.set.addSite')}>
      <h4 class="settings__subh">{t('search.set.addSite')}</h4>
      <Field label={t('search.set.name')}>
        {(id, d) => <Input id={id} aria-describedby={d} value={label} onValue={setLabel} placeholder="Kagi" />}
      </Field>
      <Field label={t('search.set.url')} hint={t('search.set.siteHint')} error={error}>
        {(id, d) => (
          <Input
            id={id}
            aria-describedby={d}
            type="url"
            value={url}
            onValue={setUrl}
            spellcheck={false}
            placeholder="https://kagi.com/search?q={{query}}"
          />
        )}
      </Field>
      <div class="settings__row">
        <Button size="s" icon="plus" onClick={add}>
          {t('search.set.add')}
        </Button>
        {check === 'ok' && (
          <Button
            size="s"
            variant="ghost"
            iconEnd="external"
            href={redirectUrl({ url }, 'AI Resonance')}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('search.set.try')}
          </Button>
        )}
      </div>
    </fieldset>
  )
}

const READER_HINTS: Record<ReaderId, MessageKey> = {
  jina: 'search.set.readerJina',
  firecrawl: 'search.set.readerFirecrawl',
  tavily: 'search.set.readerTavily',
  custom: 'search.set.readerCustom',
  none: 'search.set.readerNone',
}

function CustomReader() {
  const r = searchPrefs.value.readerCustom
  const set = (patch: Partial<ReaderSpec>) =>
    searchPrefs.set((s) => ({ readerCustom: { ...s.readerCustom, ...patch } }))
  const setReq = (patch: Partial<ReaderSpec['request']>) => set({ request: { ...r.request, ...patch } })
  const setRes = (patch: Partial<ReaderSpec['response']>) => set({ response: { ...r.response, ...patch } })
  const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v.join(', ') : (v ?? ''))
  return (
    <fieldset class="sset-form" aria-label={t('search.set.readerCustomTitle')}>
      <Field label={t('search.set.method')}>
        {(id, d) => (
          <Segmented
            id={id}
            aria-describedby={d}
            size="s"
            label={t('search.set.method')}
            value={r.request.method}
            onValue={(v) => setReq({ method: v })}
            options={[
              { value: 'GET', label: 'GET' },
              { value: 'POST', label: 'POST' },
            ]}
          />
        )}
      </Field>
      <Field label={t('search.set.url')} hint={t('search.set.readerUrlHint')}>
        {(id, d) => (
          <Input
            id={id}
            aria-describedby={d}
            value={r.request.url}
            spellcheck={false}
            onValue={(v) => setReq({ url: v.trim() })}
          />
        )}
      </Field>
      <Field label={t('search.set.headers')} hint={t('search.set.headersHint')}>
        {(id, d) => (
          <Textarea
            id={id}
            aria-describedby={d}
            code
            rows={2}
            value={formatHeaderLines(r.request.headers)}
            spellcheck={false}
            onValue={(v) => setReq({ headers: parseHeaderLines(v) })}
          />
        )}
      </Field>
      {r.request.method === 'POST' && (
        <Field label={t('search.set.body')} hint={t('search.set.readerBodyHint')}>
          {(id, d) => (
            <Textarea
              id={id}
              aria-describedby={d}
              code
              rows={2}
              value={r.request.body ?? ''}
              spellcheck={false}
              onValue={(v) => setReq({ body: v })}
            />
          )}
        </Field>
      )}
      <Field label={t('search.set.pText')} hint={t('search.set.pTextHint')}>
        {(id, d) => (
          <Input
            id={id}
            aria-describedby={d}
            value={str(r.response.text)}
            spellcheck={false}
            onValue={(v) => setRes({ text: v.trim() || undefined })}
          />
        )}
      </Field>
      <Field label={t('search.set.pTitle')}>
        {(id, d) => (
          <Input
            id={id}
            aria-describedby={d}
            value={str(r.response.title)}
            spellcheck={false}
            onValue={(v) => setRes({ title: v.trim() || undefined })}
          />
        )}
      </Field>
      <Field inline label={t('search.set.needsKey')}>
        {(id, d) => (
          <Switch
            id={id}
            aria-describedby={d}
            checked={r.auth !== 'none'}
            onChange={(v) => set({ auth: v ? 'required' : 'none' })}
          />
        )}
      </Field>
      <Field inline label={t('search.set.viaRelay')}>
        {(id, d) => <Switch id={id} aria-describedby={d} checked={!!r.relay} onChange={(v) => set({ relay: v })} />}
      </Field>
    </fieldset>
  )
}

function ReaderTest({ spec }: { spec: ReaderSpec }) {
  const [state, setState] = useState<{ busy: boolean; ok?: boolean; text?: string }>({ busy: false })
  const run = async () => {
    setState({ busy: true })
    const r = await runReaderSpec(spec, 'https://example.com/')
    if (!r.ok) return setState({ busy: false, ok: false, text: describeSearchError(r.error, spec.label) })
    const head = t('search.set.readerOk', { chars: r.text.length, ms: r.ms })
    setState({ busy: false, ok: true, text: r.title ? `${head} — ${r.title}` : head })
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

function Reader() {
  const p = searchPrefs.value
  const spec = readerSpec(p)
  const options: Array<{ value: ReaderId; label: string }> = [
    ...READERS.map((r) => ({
      value: r.id as ReaderId,
      label: r.id === 'jina' ? `${r.label} (${t('search.set.recommended')})` : r.label,
    })),
    { value: 'custom', label: t('search.set.readerCustomTitle') },
    { value: 'none', label: t('search.set.readerOff') },
  ]
  return (
    <section class="settings__group">
      <Field label={t('search.set.reader')} hint={t(READER_HINTS[p.reader] ?? 'search.set.readerJina')}>
        {(id, d) => (
          <Select
            id={id}
            aria-describedby={d}
            value={p.reader}
            onValue={(v) => searchPrefs.set({ reader: v })}
            options={options}
          />
        )}
      </Field>
      {spec && spec.id !== 'custom' && spec.auth !== 'none' && (
        <CredentialRow
          value={p.readerKeys[spec.id] ?? ''}
          kind="reader"
          optional={spec.auth === 'optional'}
          onValue={(id) => searchPrefs.set((s) => ({ readerKeys: { ...s.readerKeys, [spec.id]: id } }))}
        />
      )}
      {spec?.id === 'custom' && <CustomReader />}
      {spec?.id === 'custom' && spec.auth !== 'none' && (
        <CredentialRow
          value={p.readerKeys.custom ?? ''}
          kind="reader"
          onValue={(id) => searchPrefs.set((s) => ({ readerKeys: { ...s.readerKeys, custom: id } }))}
        />
      )}
      {spec && <ReaderTest key={spec.id} spec={spec} />}
    </section>
  )
}

function Relay() {
  const p = searchPrefs.value
  return (
    <section class="settings__group">
      <Field label={t('search.set.relay')} hint={t('search.set.relayHint')}>
        {(id, d) => (
          <Segmented<RelayMode>
            id={id}
            aria-describedby={d}
            label={t('search.set.relay')}
            value={p.relay}
            onValue={(v) => searchPrefs.set({ relay: v })}
            options={[
              { value: 'none', label: t('search.set.relayNone') },
              { value: 'local', label: t('search.set.relayLocal') },
              { value: 'custom', label: t('search.set.relayCustom') },
            ]}
          />
        )}
      </Field>
      {p.relay === 'local' && <p class="settings__hint">{t('search.set.relayLocalHint')}</p>}
      {p.relay === 'custom' && (
        <Field label={t('search.set.relayUrl')} hint={t('search.set.relayUrlHint')}>
          {(id, d) => (
            <Input
              id={id}
              aria-describedby={d}
              type="url"
              value={p.relayUrl}
              spellcheck={false}
              placeholder="https://relay.example.com/?url={{url}}"
              onValue={(v) => searchPrefs.set({ relayUrl: v.trim() })}
            />
          )}
        </Field>
      )}
      <p class="settings__hint">{t('search.set.relayTrust')}</p>
    </section>
  )
}

/** The Search settings tab. */
export default function SearchTab() {
  return (
    <div class="settings__stack" data-part="search-settings">
      <DefaultEngine />
      <MoreEngines />
      <ApiSection />
      <Reader />
      <Relay />
    </div>
  )
}
