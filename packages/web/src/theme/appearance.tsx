/**
 * Settings › Appearance (DESIGN §11): a live preview card, one-tap presets (and the site's own default), mode, accent
 * with a WCAG contrast check and a one-tap fix, density, font size, motion, custom CSS, token overrides, theme files
 * and reset. It only writes the `appearance` slice; theme/prefs.ts and theme/engine.ts put it on the page.
 */
import { useEffect, useRef, useState } from 'preact/hooks'
import { toast } from '../core/events.ts'
import { prefersDark } from '../core/media.ts'
import { href } from '../core/router.ts'
import { type MessageKey, t } from '../i18n/index.ts'
import { boardTitle, categoryLabel } from '../items/text.ts'
import { Button } from '../ui/button.tsx'
import { CategoryChip } from '../ui/chip.tsx'
import { Field, Input, Segmented, Slider, Textarea } from '../ui/form.tsx'
import { Icon } from '../ui/icons.tsx'
import { copyText } from '../ui/link.tsx'
import { RankNumeral } from '../ui/marks.tsx'
import { Dialog } from '../ui/sheet.tsx'
import {
  currentTheme,
  formatTokenLines,
  importTheme,
  liveAccentReport,
  PRESET_INFO,
  parseTheme,
  parseTokenLines,
  readableAccent,
  readToken,
  safeMode,
  themeTokens,
  toHex,
  toRgb,
  withoutSafe,
} from './engine.ts'
import { appearance, type Density, type MotionPref, resolveAppearance, siteTheme, type ThemeMode } from './prefs.ts'

const PRESET_NAMES: Record<string, MessageKey> = {
  titanium: 'theme.preset.titanium',
  paper: 'theme.preset.paper',
  terminal: 'theme.preset.terminal',
}
const PRESET_NOTES: Record<string, MessageKey> = {
  titanium: 'theme.presetNote.titanium',
  paper: 'theme.presetNote.paper',
  terminal: 'theme.presetNote.terminal',
}
const presetName = (id: string) => (PRESET_NAMES[id] ? t(PRESET_NAMES[id]) : id)
const presetNote = (id: string) => (PRESET_NOTES[id] ? t(PRESET_NOTES[id]) : '')

/** One-tap accent suggestions: each reads at ≥ 4.5:1 on the light presets' pages or is fixed by the check below. */
const ACCENTS = ['#006bd6', '#0f766e', '#b45309', '#be123c', '#7c3aed', '#4c58d6']

const row = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem' } as const
const bare = { margin: 0, padding: 0, border: 0, minWidth: 0 } as const

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** A miniature of a preset: its page, one plate with a line of text, and its signal/accent dot (flat: no glow). */
function Swatch({ colors }: { colors: [string, string, string, string] }) {
  const [bg, surface, text, accent] = colors
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'block',
        padding: '0.5rem',
        borderRadius: 'var(--radius-m)',
        background: bg,
        boxShadow: 'var(--well-edge)',
      }}
    >
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem',
          padding: '0.4rem 0.5rem',
          borderRadius: 'var(--radius-s)',
          background: surface,
          boxShadow: '0 1px 2px rgb(0 0 0 / 0.25), inset 0 1px 0 rgb(255 255 255 / 0.06)',
          color: text,
          font: '600 0.8125rem/1 var(--font-ui)',
        }}
      >
        Aa
        <span style={{ flex: '1', height: '4px', borderRadius: '2px', background: text, opacity: 0.22 }} />
        <span
          style={{
            width: '10px',
            height: '10px',
            borderRadius: '50%',
            background: accent,
            boxShadow: 'inset 0 1px 0 var(--hl)',
          }}
        />
      </span>
    </span>
  )
}

function Presets({ mode }: { mode: 'light' | 'dark' }) {
  const current = appearance.value.preset
  const site = siteTheme.value.preset || PRESET_INFO[0].id
  const siteInfo = PRESET_INFO.find((p) => p.id === site) ?? PRESET_INFO[0]
  const tiles = [
    {
      id: '',
      name: t('theme.siteDefault', { preset: presetName(site) }),
      note: t('theme.siteDefaultNote'),
      colors: siteInfo.swatch[mode],
    },
    ...PRESET_INFO.map((p) => ({
      id: p.id,
      name: presetName(p.id),
      note: presetNote(p.id),
      colors: p.swatch[mode],
    })),
  ]
  return (
    <fieldset
      aria-label={t('theme.presets')}
      style={{
        ...bare,
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(9.5rem, 1fr))',
        gap: '0.75rem',
      }}
    >
      {tiles.map((p) => {
        const on = current === p.id
        return (
          <button
            key={p.id || 'site'}
            type="button"
            class="tile"
            aria-pressed={on}
            onClick={() => appearance.set({ preset: p.id })}
          >
            <Swatch colors={p.colors} />
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                padding: '0 0.15rem',
                font: '600 var(--fs-s)/1.25 var(--font-ui)',
              }}
            >
              {on && <Icon name="check" size={14} style={{ color: 'var(--signal-text)' }} />}
              {p.name}
            </span>
            <span
              style={{
                padding: '0 0.15rem 0.1rem',
                color: 'var(--text-3)',
                fontSize: 'var(--fs-2xs)',
                lineHeight: 1.35,
              }}
            >
              {p.note}
            </span>
          </button>
        )
      })}
    </fieldset>
  )
}

function Preview() {
  // Reading the slices subscribes the preview; the page's computed tokens are already updated when it renders.
  void appearance.value
  void themeTokens.value
  const report = liveAccentReport()
  const level: MessageKey | null = !report
    ? null
    : report.level === 'fail'
      ? 'theme.contrastFail'
      : report.level === 'AA-large'
        ? 'theme.contrastLarge'
        : 'theme.contrastOk'
  const fix = () => {
    const [accent, bg, surface] = ['--accent', '--bg', '--surface'].map((n) => toRgb(readToken(n)))
    const next = accent && bg && surface ? readableAccent(accent, bg, surface) : null
    if (next) appearance.set({ accent: next })
  }
  return (
    <section class="settings__group" data-part="appearance-preview" aria-labelledby="appearance-preview-h">
      <h3 class="settings__subh" id="appearance-preview-h">
        {t('theme.preview')}
      </h3>
      <div
        style={{
          padding: '1rem',
          borderRadius: 'var(--radius-l)',
          background: 'var(--aurora), var(--grid), var(--bg)',
          boxShadow: 'var(--well-edge)',
        }}
      >
        <div
          style={{
            borderRadius: 'var(--radius-l)',
            background: 'var(--plate-bg)',
            boxShadow: 'var(--plate-edge), var(--elev-1)',
          }}
        >
          <article class="card" style={{ '--hue': 'var(--hue-repos)' }} aria-label={t('theme.preview')}>
            <div class="card__rank">
              <RankNumeral rank={1} />
              <span class="trendbadge">
                <span class="trend trend--new">{t('trend.new')}</span>
              </span>
            </div>
            <div class="card__body">
              <span class="card__board">
                <span class="card__board-dot" aria-hidden="true" />
                {boardTitle('repos')}
              </span>
              <p class="card__title">{t('theme.previewTitle')}</p>
              <p class="card__blurb">{t('theme.previewBlurb')}</p>
              {/* On a phone the chip takes its own line and the link + button stay together, right-aligned. */}
              <div class="card__foot" style={{ flexWrap: 'wrap', rowGap: '0.5rem' }}>
                <CategoryChip category="tool" label={categoryLabel('tool')} />
                <span style={{ ...row, flexWrap: 'nowrap', marginLeft: 'auto' }}>
                  <a href={href('/settings/appearance')} style={{ color: 'var(--accent)', fontSize: 'var(--fs-s)' }}>
                    {t('theme.previewLink')}
                  </a>
                  <Button size="s" variant="primary" icon="sparkle">
                    {t('theme.previewButton')}
                  </Button>
                </span>
              </div>
            </div>
          </article>
        </div>
      </div>
      {report && level && (
        <div style={{ display: 'grid', gap: '0.35rem' }}>
          <p class="settings__hint" style={{ margin: 0 }}>
            {t('theme.contrast', {
              text: report.onBg.toFixed(1),
              card: report.onSurface.toFixed(1),
              ink: report.inkRatio.toFixed(1),
            })}
          </p>
          <p
            role={report.level === 'fail' ? 'alert' : 'status'}
            style={{
              ...row,
              margin: 0,
              color: report.level === 'AA' || report.level === 'AAA' ? 'var(--ok)' : 'var(--warn)',
              fontSize: 'var(--fs-s)',
            }}
          >
            <Icon name={report.level === 'AA' || report.level === 'AAA' ? 'check' : 'warn'} size={16} />
            {t(level)}
            {(report.level === 'fail' || report.level === 'AA-large') && (
              <Button size="s" onClick={fix}>
                {t('theme.contrastFix')}
              </Button>
            )}
          </p>
        </div>
      )}
    </section>
  )
}

function Accent() {
  const a = appearance.value
  const r = resolveAppearance(a, siteTheme.value, prefersDark.value)
  const current = r.accent || readToken('--accent')
  const rgb = toRgb(current)
  const [draft, setDraft] = useState(a.accent)
  const [invalid, setInvalid] = useState(false)
  useEffect(() => setDraft(a.accent), [a.accent])
  const commit = (v: string) => {
    const value = v.trim()
    const ok = !value || typeof CSS === 'undefined' || !CSS.supports || CSS.supports('color', value)
    setInvalid(!ok)
    if (ok) appearance.set({ accent: value })
  }
  return (
    <Field
      label={t('theme.accent')}
      hint={t('theme.accentHint')}
      error={invalid ? t('theme.accentInvalid') : undefined}
    >
      {(id, describedBy) => (
        <div style={{ display: 'grid', gap: '0.6rem' }}>
          <div style={row}>
            <input
              id={id}
              type="color"
              aria-describedby={describedBy}
              value={rgb ? toHex(rgb) : '#0a84ff'}
              onInput={(e) => appearance.set({ accent: e.currentTarget.value })}
              style={{
                width: '44px',
                height: '44px',
                padding: '4px',
                border: 0,
                borderRadius: 'var(--radius-m)',
                background: 'var(--well-bg)',
                boxShadow: 'var(--well-edge)',
                cursor: 'pointer',
              }}
            />
            <span style={{ flex: '1 1 12rem', minWidth: 0 }}>
              <Input
                value={draft}
                onValue={setDraft}
                onBlur={() => commit(draft)}
                onKeyDown={(e) => e.key === 'Enter' && commit(draft)}
                placeholder={t('theme.accentPlaceholder')}
                aria-label={t('theme.accentCustom')}
                spellcheck={false}
              />
            </span>
            {a.accent && (
              <Button size="s" variant="ghost" icon="refresh" onClick={() => appearance.set({ accent: '' })}>
                {t('theme.accentReset')}
              </Button>
            )}
          </div>
          <fieldset aria-label={t('theme.accentSuggest')} style={{ ...bare, ...row, gap: '0.25rem' }}>
            {ACCENTS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                title={c}
                aria-pressed={a.accent === c}
                onClick={() => appearance.set({ accent: c })}
                style={{
                  display: 'grid',
                  placeItems: 'center',
                  width: 'var(--target)',
                  height: 'var(--target)',
                  padding: 0,
                  border: 0,
                  background: 'none',
                  cursor: 'pointer',
                }}
              >
                <span
                  style={{
                    width: '26px',
                    height: '26px',
                    borderRadius: '50%',
                    background: `linear-gradient(180deg, rgb(255 255 255 / 0.18), transparent 60%) ${c}`,
                    boxShadow:
                      a.accent === c
                        ? '0 0 0 2px var(--surface), 0 0 0 3.5px var(--signal)'
                        : 'inset 0 0 0 1px rgb(0 0 0 / 0.15), 0 1px 2px rgb(0 0 0 / 0.25)',
                  }}
                />
              </button>
            ))}
          </fieldset>
        </div>
      )}
    </Field>
  )
}

function CustomCss() {
  const saved = appearance.value.customCss
  const [draft, setDraft] = useState(saved)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  // An import or reset replaces the saved CSS from elsewhere.
  useEffect(() => setDraft(saved), [saved])
  const onValue = (v: string) => {
    setDraft(v)
    // Apply shortly after typing stops: half-typed rules are harmless but restyling on every key is jumpy.
    clearTimeout(timer.current)
    timer.current = setTimeout(() => appearance.set({ customCss: v }), 400)
  }
  return (
    <Field label={t('theme.css')} hint={t('theme.cssHint')}>
      {(id, describedBy) => (
        <Textarea
          id={id}
          aria-describedby={describedBy}
          code
          rows={6}
          value={draft}
          spellcheck={false}
          placeholder={"[data-part='item-card'] { border-radius: 0; }"}
          onValue={onValue}
        />
      )}
    </Field>
  )
}

function Tokens() {
  const saved = themeTokens.value.tokens
  const [draft, setDraft] = useState(() => formatTokenLines(saved))
  const [bad, setBad] = useState<number[]>([])
  const mine = useRef(formatTokenLines(saved))
  // Follow imports/resets, but never rewrite the box after its own Apply (that would erase lines being fixed).
  useEffect(() => {
    const text = formatTokenLines(saved)
    if (text !== mine.current) {
      mine.current = text
      setDraft(text)
      setBad([])
    }
  }, [saved])
  const apply = () => {
    const r = parseTokenLines(draft)
    mine.current = formatTokenLines(r.tokens)
    setBad(r.bad)
    themeTokens.set({ tokens: r.tokens })
    if (!r.bad.length) toast(t('theme.tokensSaved', { n: Object.keys(r.tokens).length }), { kind: 'ok' })
  }
  return (
    <Field
      label={t('theme.tokens')}
      hint={t('theme.tokensHint')}
      error={bad.length ? t('theme.tokensBad', { lines: bad.join(', ') }) : undefined}
    >
      {(id, describedBy) => (
        <div style={{ display: 'grid', gap: '0.5rem' }}>
          <Textarea
            id={id}
            aria-describedby={describedBy}
            code
            rows={4}
            value={draft}
            spellcheck={false}
            placeholder={'--radius-m: 4px\n--spill: none'}
            onValue={setDraft}
          />
          <div class="settings__row">
            <Button size="s" icon="check" onClick={apply}>
              {t('theme.tokensApply')}
            </Button>
            {Object.keys(saved).length > 0 && (
              <Button
                size="s"
                variant="ghost"
                onClick={() => {
                  setDraft('')
                  setBad([])
                  themeTokens.set({ tokens: {} })
                }}
              >
                {t('theme.tokensClear')}
              </Button>
            )}
          </div>
        </div>
      )}
    </Field>
  )
}

function ThemeFile() {
  const file = useRef<HTMLInputElement>(null)
  const [confirm, setConfirm] = useState(false)
  const onImport = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement
    const f = input.files?.[0]
    input.value = ''
    if (!f) return
    const r = parseTheme(await f.text())
    if (!r.ok) return toast(t('theme.importFailed'), { kind: 'danger' })
    importTheme(r.theme)
    toast(r.dropped.length ? t('theme.importedDropped', { fields: r.dropped.join(', ') }) : t('theme.imported'), {
      kind: r.dropped.length ? 'warn' : 'ok',
    })
  }
  return (
    <section class="settings__group">
      <h3 class="settings__subh">{t('theme.file')}</h3>
      <p class="settings__hint">{t('theme.fileHint')}</p>
      <div class="settings__row">
        <Button size="s" icon="download" onClick={() => download('ai-resonance-theme.json', currentTheme())}>
          {t('theme.export')}
        </Button>
        <Button
          size="s"
          icon="copy"
          onClick={async () => toast(t((await copyText(currentTheme())) ? 'theme.copied' : 'theme.copyFailed'))}
        >
          {t('theme.copy')}
        </Button>
        <Button size="s" icon="upload" onClick={() => file.current?.click()}>
          {t('theme.import')}
        </Button>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={onImport} />
        <Button size="s" variant="danger" icon="refresh" onClick={() => setConfirm(true)}>
          {t('theme.reset')}
        </Button>
      </div>
      <Dialog
        open={confirm}
        alert
        onClose={() => setConfirm(false)}
        title={t('theme.resetTitle')}
        actions={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              {t('ui.cancel')}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                appearance.reset()
                setConfirm(false)
                toast(t('theme.resetDone'), { kind: 'ok' })
              }}
            >
              {t('theme.resetConfirm')}
            </Button>
          </>
        }
      >
        <p>{t('theme.resetBody')}</p>
      </Dialog>
    </section>
  )
}

/** The Appearance tab. */
export default function AppearanceTab() {
  const a = appearance.value
  const mode = resolveAppearance(a, siteTheme.value, prefersDark.value).mode
  return (
    <div class="settings__stack" data-part="appearance-settings">
      {safeMode.value && (
        <p
          class="settings__group"
          role="status"
          style={{
            ...row,
            color: 'var(--text)',
            boxShadow: 'var(--plate-edge), var(--elev-1), inset 0 0 0 1px var(--warn)',
          }}
        >
          <Icon name="warn" size={18} />
          <span style={{ flex: '1 1 16rem' }}>{t('theme.safe')}</span>
          <Button size="s" href={withoutSafe(window.location.href)}>
            {t('theme.safeLeave')}
          </Button>
        </p>
      )}
      <Preview />
      <section class="settings__group">
        <h3 class="settings__subh">{t('theme.presets')}</h3>
        <Presets mode={mode} />
        <Field label={t('theme.mode')}>
          {(id, describedBy) => (
            <Segmented<ThemeMode>
              id={id}
              aria-describedby={describedBy}
              label={t('theme.mode')}
              value={a.mode}
              onValue={(v) => appearance.set({ mode: v })}
              options={[
                { value: 'auto', label: t('theme.modeAuto'), icon: 'contrast' },
                { value: 'light', label: t('theme.modeLight'), icon: 'sun' },
                { value: 'dark', label: t('theme.modeDark'), icon: 'moon' },
              ]}
            />
          )}
        </Field>
      </section>
      <section class="settings__group">
        <Accent />
      </section>
      <section class="settings__group">
        <Field label={t('theme.density')}>
          {(id, describedBy) => (
            <Segmented<Density>
              id={id}
              aria-describedby={describedBy}
              label={t('theme.density')}
              value={a.density}
              onValue={(v) => appearance.set({ density: v })}
              options={[
                { value: 'compact', label: t('theme.densityCompact') },
                { value: 'comfortable', label: t('theme.densityComfortable') },
                { value: 'cozy', label: t('theme.densityCozy') },
              ]}
            />
          )}
        </Field>
        <Field label={t('theme.fontSize')}>
          {(id, describedBy) => (
            <Slider
              id={id}
              aria-describedby={describedBy}
              value={a.fontScale}
              min={0.85}
              max={1.3}
              step={0.05}
              onValue={(v) => appearance.set({ fontScale: Math.round(v * 100) / 100 })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          )}
        </Field>
        <Field label={t('theme.motion')} hint={t('theme.motionHint')}>
          {(id, describedBy) => (
            <Segmented<MotionPref>
              id={id}
              aria-describedby={describedBy}
              label={t('theme.motion')}
              value={a.motion}
              onValue={(v) => appearance.set({ motion: v })}
              options={[
                { value: 'system', label: t('theme.motionSystem') },
                { value: 'reduce', label: t('theme.motionReduce') },
                { value: 'full', label: t('theme.motionFull') },
              ]}
            />
          )}
        </Field>
      </section>
      <section class="settings__group">
        <h3 class="settings__subh">{t('theme.advanced')}</h3>
        <p class="settings__hint">{t('theme.advancedHint')}</p>
        <CustomCss />
        <Tokens />
      </section>
      <ThemeFile />
    </div>
  )
}
