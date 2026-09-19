/**
 * The report's inline controller (vanilla JS, no framework). It only enhances a page that is already complete without
 * it: board tabs, category chips, text filter, language and theme switches, local-time window, print expansion.
 *
 * Text it writes goes through `textContent` / attributes only — never `innerHTML` — so embedded data cannot inject
 * markup. Everything else it needs comes from the JSON block `#air-data`.
 */
import { DATE_OPTS, DATETIME_OPTS, LOCALES } from './fmt.ts'

const SOURCE = `
(() => {
const d = document, h = d.documentElement
const $ = (s, r) => Array.from((r || d).querySelectorAll(s))
const byId = (i) => d.getElementById(i)
const data = JSON.parse(byId('air-data').textContent)
const R = data.report, UI = data.ui, TZ = R.window.timezone
const LOC = ${JSON.stringify(LOCALES)}, DT = ${JSON.stringify(DATETIME_OPTS)}, DO = ${JSON.stringify(DATE_OPTS)}
const store = {
  get: (k) => { try { return localStorage.getItem(k) } catch (e) { return null } },
  set: (k, v) => { try { localStorage.setItem(k, v) } catch (e) {} },
}
h.classList.remove('nojs')

const hay = {}
R.sections.forEach((s, si) => s.items.forEach((it, ii) => {
  const bits = [it.title, it.summary, it.category || '', (it.tags || []).join(' ')]
  for (const l in it.copy || {}) {
    const c = it.copy[l] || {}
    bits.push(c.title || '', c.blurb || '', c.why || '', (c.points || []).join(' '))
  }
  const x = it.repo || it.paper || it.news || it.social || it.lab || {}
  for (const k of ['owner', 'name', 'language', 'venue', 'domain', 'author', 'handle', 'community', 'companyName', 'surface']) {
    if (typeof x[k] === 'string') bits.push(x[k])
  }
  if (Array.isArray(x.authors)) bits.push(x.authors.join(' '))
  hay[si + '.' + ii] = bits.join(' ').toLowerCase()
}))

const st = { tab: 'all', cat: '', q: '' }
function apply() {
  const toks = st.q.toLowerCase().split(/\\s+/).filter(Boolean)
  const filtering = !!st.cat || toks.length > 0
  let shown = 0
  for (const sec of $('.sec[data-board]')) {
    const on = st.tab === 'all' || st.tab === sec.dataset.board
    let n = 0
    for (const c of $('.card', sec)) {
      const ok = on && (!st.cat || c.dataset.cat === st.cat) && toks.every((t) => (hay[c.dataset.x] || '').includes(t))
      c.hidden = !ok
      if (ok) n++
    }
    sec.hidden = !on || (filtering && n === 0)
    shown += n
  }
  for (const s of $('.front')) s.hidden = st.tab !== 'all' || filtering
  byId('nomatch').hidden = !filtering || shown > 0
}

const tabs = $('[role=tab]')
function selectTab(t, focus) {
  for (const x of tabs) {
    x.setAttribute('aria-selected', String(x === t))
    x.tabIndex = x === t ? 0 : -1
  }
  st.tab = t.dataset.tab
  apply()
  if (focus) t.focus()
}
tabs.forEach((t, i) => {
  t.addEventListener('click', () => selectTab(t))
  t.addEventListener('keydown', (e) => {
    const n = tabs.length, k = e.key
    const j = k === 'ArrowRight' ? (i + 1) % n : k === 'ArrowLeft' ? (i + n - 1) % n : k === 'Home' ? 0 : k === 'End' ? n - 1 : -1
    if (j < 0) return
    e.preventDefault()
    selectTab(tabs[j], true)
  })
})

const chips = $('.chip')
function pressChip(c) {
  for (const x of chips) x.setAttribute('aria-pressed', String(x === c))
  st.cat = c.dataset.cat
  apply()
}
for (const c of chips) c.addEventListener('click', () => pressChip(c))

const q = byId('q')
let timer = 0
q.addEventListener('input', () => {
  clearTimeout(timer)
  timer = setTimeout(() => { st.q = q.value; apply() }, 120)
})
function reset() {
  q.value = ''
  st.q = ''
  if (chips.length) pressChip(chips[0])
  selectTab(tabs[0])
}
byId('clear').addEventListener('click', reset)
d.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('a[href^="#"]')
  const el = a && byId(decodeURIComponent(a.getAttribute('href').slice(1)))
  if (el && el.closest('[hidden]')) reset()
})

function fmt(iso, zone, l, o) {
  try { return new Intl.DateTimeFormat(LOC[l], Object.assign({}, o || DT, { timeZone: zone })).format(new Date(iso)) } catch (e) { return iso }
}
function setLang(l) {
  const t = UI[l]
  if (!t) return
  h.lang = l
  for (const el of $('[data-s]')) {
    const v = t[el.dataset.s]
    if (v != null) el.textContent = v.replace('{n}', el.dataset.n || '')
  }
  for (const el of $('[data-sp]')) el.placeholder = t[el.dataset.sp] || ''
  for (const el of $('[data-sa]')) el.setAttribute('aria-label', t[el.dataset.sa] || '')
  for (const el of $('[data-d]')) el.textContent = fmt(el.dataset.d, TZ, l, el.dataset.o === 'd' ? DO : DT)
  for (const b of $('[data-lang]')) b.setAttribute('aria-pressed', String(b.dataset.lang === l))
  const local = Intl.DateTimeFormat().resolvedOptions().timeZone
  const le = byId('local'), w = R.window
  if (le && local) {
    le.textContent = t.yourTime + ': ' + fmt(w.from, local, l) + ' – ' + fmt(w.to, local, l) + ' (' + local + ')'
    le.hidden = fmt(w.from, local, l) === fmt(w.from, TZ, l)
  }
  d.title = R.site.name + ' · ' + t[R.kind] + ' ' + R.id
}
for (const b of $('[data-lang]')) b.addEventListener('click', () => { setLang(b.dataset.lang); store.set('air-lang', b.dataset.lang) })

const modes = ['auto', 'light', 'dark'], tb = byId('theme')
function setTheme(m) {
  h.dataset.theme = m
  const s = tb.querySelector('[data-s]')
  s.dataset.s = m
  s.textContent = UI[h.lang][m]
}
tb.addEventListener('click', () => {
  const m = modes[(modes.indexOf(h.dataset.theme) + 1) % modes.length]
  setTheme(m)
  store.set('air-theme', m)
})

let opened = []
addEventListener('beforeprint', () => { opened = $('details:not([open])'); for (const x of opened) x.open = true })
addEventListener('afterprint', () => { for (const x of opened) x.open = false })

const savedLang = store.get('air-lang'), savedTheme = store.get('air-theme')
setLang(UI[savedLang] ? savedLang : h.lang)
if (modes.includes(savedTheme)) setTheme(savedTheme)
apply()
})()
`

/** The controller source, indentation stripped (it is inlined into every report). */
export const CONTROLLER = SOURCE.replace(/\n\s+/g, '\n').trim()
