/**
 * Settings › General: language, which boards to show and in what order, link behaviour, cached data, and settings
 * backup (export/import without secrets — every slice's `redact` runs first).
 */
import type { Board } from '@resonance/schema'
import { useRef, useState } from 'preact/hooks'
import { clearCaches } from '../core/api.ts'
import { emit, toast } from '../core/events.ts'
import { boardOrder, exportSettings, general, type ImportPlan, planImport, resetSettings } from '../core/settings.ts'
import { boardMetas } from '../core/state.ts'
import { lang, localized, type MessageKey, setLang, t } from '../i18n/index.ts'
import { boardTitle } from '../items/text.ts'
import { Button, IconButton } from '../ui/button.tsx'
import { boardHue } from '../ui/chip.tsx'
import { Field, Segmented, Switch } from '../ui/form.tsx'
import { Dialog } from '../ui/sheet.tsx'

/** Pure: move `board` one step in `order` (no-op at the ends). */
export function moveBoard(order: readonly Board[], board: Board, dir: -1 | 1): Board[] {
  const i = order.indexOf(board)
  const j = i + dir
  if (i < 0 || j < 0 || j >= order.length) return [...order]
  const next = [...order]
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}

function download(name: string, text: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function Boards() {
  const g = general.value
  const { order } = boardOrder(g.boards, g.hidden)
  const metas = boardMetas.value
  return (
    <ul class="boardprefs" aria-label={t('general.boards')}>
      {order.map((b, i) => {
        const meta = metas.get(b)
        const name = boardTitle(b, meta)
        const shown = !g.hidden.includes(b)
        return (
          <li key={b} class={`boardprefs__row${shown ? '' : ' is-hidden'}`} style={{ '--hue': boardHue(b) }}>
            <span class="boardprefs__dot" aria-hidden="true" />
            <span class="boardprefs__text">
              <strong>{name}</strong>
              {meta && <span>{localized(meta.subtitle)}</span>}
            </span>
            <IconButton
              size="s"
              icon="chevron-up"
              label={t('general.moveUp', { board: name })}
              disabled={i === 0}
              onClick={() => general.set({ boards: moveBoard(order, b, -1) })}
            />
            <IconButton
              size="s"
              icon="chevron-down"
              label={t('general.moveDown', { board: name })}
              disabled={i === order.length - 1}
              onClick={() => general.set({ boards: moveBoard(order, b, 1) })}
            />
            <Switch
              checked={shown}
              label={t('general.showBoard', { board: name })}
              onChange={(on) => general.set({ hidden: on ? g.hidden.filter((x) => x !== b) : [...g.hidden, b] })}
            />
          </li>
        )
      })}
    </ul>
  )
}

/** The General tab. */
export function GeneralTab() {
  const g = general.value
  const file = useRef<HTMLInputElement>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [busy, setBusy] = useState(false)

  const [pending, setPending] = useState<ImportPlan | null>(null)

  const apply = (plan: ImportPlan) => {
    plan.apply()
    setPending(null)
    emit('settings:imported', { slices: plan.slices })
    toast(t('general.imported', { n: plan.slices.length }), { kind: 'ok' })
  }

  const onImport = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement
    const f = input.files?.[0]
    input.value = ''
    if (!f) return
    const plan = planImport(await f.text())
    if (!plan.ok) toast(t('general.importFailed'), { kind: 'danger' })
    // A file that moves where requests (and keys) go is shown before anything changes.
    else if (plan.changed.length) setPending(plan)
    else apply(plan)
  }

  return (
    <div class="settings__stack">
      <section class="settings__group">
        <Field label={t('general.language')} hint={t('general.languageHint')}>
          {(id, describedBy) => (
            <Segmented
              id={id}
              aria-describedby={describedBy}
              label={t('general.language')}
              value={g.lang ?? 'auto'}
              onValue={(v) => setLang(v === 'auto' ? null : v)}
              options={[
                { value: 'auto', label: t('general.langAuto', { lang: lang.value === 'zh' ? '中文' : 'English' }) },
                { value: 'en', label: 'English' },
                { value: 'zh', label: '中文' },
              ]}
            />
          )}
        </Field>
      </section>

      <section class="settings__group">
        <h3 class="settings__subh">{t('general.boards')}</h3>
        <p class="settings__hint">{t('general.boardsHint')}</p>
        <Boards />
        <div class="settings__row">
          <Button
            size="s"
            variant="ghost"
            icon="refresh"
            onClick={() => general.set({ boards: general.defaults.boards, hidden: [] })}
          >
            {t('general.boardsReset')}
          </Button>
        </div>
      </section>

      <section class="settings__group">
        <Field inline label={t('general.newTab')} hint={t('general.newTabHint')}>
          {(id, describedBy) => (
            <Switch
              id={id}
              aria-describedby={describedBy}
              checked={g.newTab}
              onChange={(v) => general.set({ newTab: v })}
            />
          )}
        </Field>
      </section>

      <section class="settings__group">
        <h3 class="settings__subh">{t('general.data')}</h3>
        <p class="settings__hint">{t('general.cachesHint')}</p>
        <div class="settings__row">
          <Button
            icon="trash"
            loading={busy}
            onClick={async () => {
              setBusy(true)
              await clearCaches()
              emit('caches:cleared')
              setBusy(false)
              toast(t('general.cachesCleared'), { kind: 'ok' })
            }}
          >
            {t('general.clearCaches')}
          </Button>
        </div>
      </section>

      <section class="settings__group">
        <h3 class="settings__subh">{t('general.backup')}</h3>
        <p class="settings__hint">{t('general.backupHint')}</p>
        <div class="settings__row">
          <Button
            icon="download"
            onClick={() =>
              download(`ai-resonance-settings-${new Date().toISOString().slice(0, 10)}.json`, exportSettings())
            }
          >
            {t('general.export')}
          </Button>
          <Button icon="upload" onClick={() => file.current?.click()}>
            {t('general.import')}
          </Button>
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={onImport} />
          <Button variant="danger" icon="refresh" onClick={() => setConfirmReset(true)}>
            {t('general.reset')}
          </Button>
        </div>
      </section>

      <Dialog
        open={confirmReset}
        alert
        onClose={() => setConfirmReset(false)}
        title={t('general.resetTitle')}
        actions={
          <>
            <Button variant="ghost" onClick={() => setConfirmReset(false)}>
              {t('ui.cancel')}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                resetSettings()
                setConfirmReset(false)
                toast(t('general.resetDone'), { kind: 'ok' })
              }}
            >
              {t('general.resetConfirm')}
            </Button>
          </>
        }
      >
        <p>{t('general.resetBody')}</p>
      </Dialog>

      {pending && (
        <Dialog
          open
          alert
          onClose={() => setPending(null)}
          title={t('general.importConfirmTitle')}
          actions={
            <>
              <Button variant="ghost" onClick={() => setPending(null)}>
                {t('ui.cancel')}
              </Button>
              <Button variant="primary" onClick={() => apply(pending)}>
                {t('general.importApply')}
              </Button>
            </>
          }
        >
          <p>{t('general.importConfirmBody')}</p>
          <ul>
            {pending.changed.map((id) => (
              <li key={id}>{t(IMPORT_CHANGES[id] ?? 'general.change.other')}</li>
            ))}
          </ul>
        </Dialog>
      )}
    </div>
  )
}

/** What each endpoint-bearing import change is called in the confirmation (`ImportCheck.changed` ids). */
const IMPORT_CHANGES: Record<string, MessageKey> = {
  'search.relay': 'general.change.relay',
  'search.customApi': 'general.change.customApi',
  'search.readerCustom': 'general.change.reader',
  'search.custom': 'general.change.redirect',
  'delivery.repo': 'general.change.repo',
  'delivery.smtp': 'general.change.smtp',
}

export default GeneralTab
