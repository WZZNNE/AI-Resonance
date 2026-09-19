import { describe, expect, it } from 'vitest'
import { type RouteDef, resolveRoute, shortcutMatches } from '../../src/core/registry.ts'
import { buildHash, matchPath, parseHash, resumeId } from '../../src/core/router.ts'

const Stub = () => null

describe('parseHash / buildHash', () => {
  it('parses path and query, tolerating a missing slash and trailing slashes', () => {
    expect(parseHash('#/d/2026-09-18?cat=research')).toEqual({ path: '/d/2026-09-18', query: { cat: 'research' } })
    expect(parseHash('#settings/general/')).toEqual({ path: '/settings/general', query: {} })
    expect(parseHash('')).toEqual({ path: '/', query: {} })
    expect(parseHash('#/')).toEqual({ path: '/', query: {} })
  })

  it('decodes the path but survives a malformed escape', () => {
    expect(parseHash('#/search/%E5%85%B1%E6%8C%AF').path).toBe('/search/共振')
    expect(parseHash('#/x/%E0%A4%A').path).toBe('/x/%E0%A4%A')
  })

  it('round-trips and drops empty query values', () => {
    const hash = buildHash('/item/gh~a~b', { d: '2026-09-18', cat: undefined, x: '' })
    expect(hash).toBe('#/item/gh~a~b?d=2026-09-18')
    expect(parseHash(hash)).toEqual({ path: '/item/gh~a~b', query: { d: '2026-09-18' } })
    expect(buildHash('live')).toBe('#/live')
  })
})

describe('resumeId', () => {
  it('continues above every id this tab handed out, so a reload never reuses one', () => {
    // 18 entries pushed before the reload, the reader now on entry 5: new entries start at 19.
    expect(resumeId('18', 5)).toBe(18)
    expect(resumeId(null, 7)).toBe(7)
    expect(resumeId('garbage', undefined)).toBe(0)
    expect(resumeId(null, null)).toBe(0)
  })
})

describe('matchPath', () => {
  it('captures params and decodes them', () => {
    expect(matchPath('/item/:slug', '/item/url~anthropic.com~news%20x')).toEqual({ slug: 'url~anthropic.com~news x' })
    expect(matchPath('/d/:date', '/d/2026-09-18')).toEqual({ date: '2026-09-18' })
  })

  it('requires the same number of segments unless the pattern ends in *', () => {
    expect(matchPath('/settings/:tab', '/settings')).toBeNull()
    expect(matchPath('/settings', '/settings/general')).toBeNull()
    expect(matchPath('/docs/*', '/docs/a/b/c')).toEqual({ rest: 'a/b/c' })
    expect(matchPath('/', '/')).toEqual({})
  })
})

describe('resolveRoute', () => {
  const routes: RouteDef[] = [
    { path: '/settings/:tab', component: Stub },
    { path: '/settings/appearance', component: Stub },
    { path: '/:anything', component: Stub },
    { path: '/', component: Stub },
  ]

  it('prefers static segments over params', () => {
    expect(resolveRoute('/settings/appearance', routes)?.route.path).toBe('/settings/appearance')
    expect(resolveRoute('/settings/general', routes)?.route.path).toBe('/settings/:tab')
    expect(resolveRoute('/live', routes)?.route.path).toBe('/:anything')
    expect(resolveRoute('/', routes)?.route.path).toBe('/')
  })

  it('returns null when nothing matches', () => {
    expect(resolveRoute('/a/b/c', routes)).toBeNull()
  })
})

describe('shortcutMatches', () => {
  const key = (k: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey', boolean>> = {}) => ({
    key: k,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...mods,
  })

  it('maps mod to ⌘ on Mac and Ctrl elsewhere', () => {
    expect(shortcutMatches('mod+k', key('k', { metaKey: true }), true)).toBe(true)
    expect(shortcutMatches('mod+k', key('k', { ctrlKey: true }), true)).toBe(false)
    expect(shortcutMatches('mod+k', key('k', { ctrlKey: true }), false)).toBe(true)
  })

  it('matches bare keys only without modifiers, and symbols regardless of Shift', () => {
    expect(shortcutMatches('/', key('/'))).toBe(true)
    expect(shortcutMatches('[', key('[', { ctrlKey: true }), false)).toBe(false)
    expect(shortcutMatches('?', key('?', { shiftKey: true }))).toBe(true)
    expect(shortcutMatches('k', key('K', { shiftKey: true }))).toBe(false)
  })
})
