/**
 * Extension points. Features self-register from their `src/<feature>/index.ts` (loaded by `main.tsx`); the shell
 * renders whatever is here and knows nothing about AI, search or theming. Every `register*` returns an unregister
 * function. Cross-feature calls go through `runCommand(id, ...args)` so features never import each other.
 */
import { computed, type ReadonlySignal, signal } from '@preact/signals'
import type { DateStr, Item, Lang } from '@resonance/schema'
import type { FunctionComponent } from 'preact'
import type { MessageKey } from '../i18n/index.ts'
import type { IconName } from '../ui/icons.tsx'
import { matchPath } from './router.ts'

export interface SettingsTab {
  /** Route segment: `#/settings/<id>`. */
  id: string
  title: MessageKey
  icon: IconName
  order: number
  component: FunctionComponent
}

export interface ItemActionCtx {
  lang: Lang
  /** Edition the item was shown in (`'live'` for the open edition); undefined when unknown. */
  date?: DateStr | 'live'
  toast: (message: string) => void
  navigate: (path: string, query?: Record<string, string | undefined>) => void
  /** Where the action was triggered from; sheets may want more room than cards. */
  placement: 'card' | 'detail'
}

export interface ItemAction {
  id: string
  label: MessageKey
  icon: IconName
  order: number
  /** Hide the action for items it does not apply to. */
  when?: (item: Item) => boolean
  /** Imperative action; the shell renders an icon button for it. */
  run?: (item: Item, ctx: ItemActionCtx) => void | Promise<void>
  /** Or a custom control (gets the same item + ctx). Takes precedence over `run`. */
  component?: FunctionComponent<{ item: Item; ctx: ItemActionCtx }>
}

/**
 * Typed command signatures. Features add theirs by declaration merging:
 *
 *   declare module '../core/registry.ts' { interface CommandMap { 'vault.secret': (id: string) => Promise<string | null> } }
 */
export interface CommandMap {
  /** Open the search palette, optionally pre-filled. Registered by `src/search`. */
  'search.open': (query?: string) => void
  /** Go to Today (latest edition). */
  'nav.today': () => void
  /** Open settings, optionally on a tab id. */
  'nav.settings': (tab?: string) => void
  /** Step to the previous (older) / next (newer) edition. */
  'edition.prev': () => void
  'edition.next': () => void
  /** Toggle between English and Chinese. */
  'app.lang': () => void
  /** Cycle theme mode auto → light → dark. */
  'app.mode': () => void
}

/** A service a stored key can be for (a model provider, a search API…), offered when a key is added. */
export interface CredentialService {
  id: string
  label: string
  /** Where to create a key for it. */
  keyUrl?: string
}

/** One place that uses a stored key, shown on the key's row. */
export interface CredentialUse {
  credentialId: string
  /** Where, in the reader's words (`Models · DeepSeek`). */
  label: string
  /** Settings route that manages it. */
  href: string
}

/**
 * How a feature ties vault keys to what it configures, so the Credentials tab can offer "which service is this key
 * for?" and show where each key is used — without the vault knowing about models or search engines.
 */
export interface CredentialLinker {
  /** Credential kinds it takes (`llm`, `search`, `reader`, `github`). */
  kinds: readonly string[]
  /** The settings page it lives on, for "will be connected in …" (`Settings › Models`). */
  area: () => string
  /** Services a key of `kind` can be added for; empty when the feature just picks any key of that kind. */
  services?: (kind: string) => Promise<CredentialService[]>
  /** Every current binding. Reads settings signals, so it is reactive inside components. */
  uses: () => CredentialUse[]
  /** Connect a new key to `serviceId` (setting that service up if needed); what it is used by now, or `null`. */
  attach?: (kind: string, serviceId: string, credentialId: string) => Promise<CredentialUse | null>
}

type AnyFn = (...args: never[]) => unknown
export type CommandId = keyof CommandMap | (string & {})
type CommandFn<K> = K extends keyof CommandMap ? CommandMap[K] : (...args: unknown[]) => unknown

export interface Command<K extends CommandId = CommandId> {
  id: K
  /** Shown in palettes / tooltips. */
  title?: MessageKey
  /** Shortcuts such as `'/'`, `'mod+k'`, `'['`. Single keys are ignored while typing in a field. */
  keys?: string[]
  order?: number
  run: CommandFn<K>
}

export interface RouteProps {
  /** The matched path, e.g. `/d/2026-09-18`. */
  path: string
  params: Record<string, string>
  query: Record<string, string>
}

export interface RouteDef {
  /** Pattern with `:params`, e.g. `'/weekly/:week'`; `'/x/*'` captures the rest as `params.rest`. */
  path: string
  component: FunctionComponent<RouteProps>
  /** For `document.title`; views may override at runtime with `setTitle`. */
  title?: MessageKey
  /** Rendered as a sheet/drawer over the previous page instead of replacing it (item detail). */
  overlay?: boolean
}

function collection<T extends { id: string; order?: number }>() {
  const items = signal<T[]>([])
  const sorted = computed(() => [...items.value].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)))
  const register = (item: T) => {
    items.value = [...items.value.filter((x) => x.id !== item.id), item]
    return () => {
      items.value = items.value.filter((x) => x !== item)
    }
  }
  return { list: sorted, register }
}

const tabs = collection<SettingsTab>()
const actions = collection<ItemAction>()
const commands = collection<Command>()
const routesSig = signal<RouteDef[]>([])
/** A feature's linker, loaded on demand (only the Credentials tab needs it; it stays out of the initial bundle). */
export interface CredentialLinkerEntry {
  id: string
  order?: number
  load: () => Promise<CredentialLinker>
}

const linkers = collection<CredentialLinkerEntry>()

/** All settings tabs, sorted by `order`. */
export const settingsTabs: ReadonlySignal<SettingsTab[]> = tabs.list
/** All item actions, sorted by `order`. */
export const itemActions: ReadonlySignal<ItemAction[]> = actions.list
/** All commands, sorted by `order` (registration order when equal). */
export const commandList: ReadonlySignal<Command[]> = commands.list
/** All routes in registration order. */
export const routes: ReadonlySignal<RouteDef[]> = routesSig

/** Add a tab to Settings. */
export const registerSettingsTab: (tab: SettingsTab) => () => void = tabs.register
/** Add an action to every item card + detail (filter with `when`). */
export const registerItemAction: (action: ItemAction) => () => void = actions.register

/** Every feature's credential linker entry, sorted by `order`. */
export const credentialLinkers: ReadonlySignal<CredentialLinkerEntry[]> = linkers.list
/** Let the Credentials tab offer this feature's services and show where its keys are used. */
export const registerCredentialLinker: (entry: CredentialLinkerEntry) => () => void = linkers.register

/** Add a named command, optionally bound to keyboard shortcuts. Re-registering an id replaces it. */
export function registerCommand<K extends CommandId>(cmd: Command<K>): () => void {
  return commands.register(cmd as unknown as Command)
}

/** Add a route. Later registrations for the same `path` replace earlier ones. */
export function registerRoute(route: RouteDef): () => void {
  routesSig.value = [...routesSig.value.filter((r) => r.path !== route.path), route]
  return () => {
    routesSig.value = routesSig.value.filter((r) => r !== route)
  }
}

/** Find the route for a path; static segments win over `:params`, longer patterns over shorter. */
export function resolveRoute(
  path: string,
  list: RouteDef[] = routesSig.value,
): { route: RouteDef; params: Record<string, string> } | null {
  let best: { route: RouteDef; params: Record<string, string>; score: number } | null = null
  for (const route of list) {
    const params = matchPath(route.path, path)
    if (!params) continue
    const segs = route.path.split('/').filter(Boolean)
    const score = segs.reduce((s, p) => s + (p.startsWith(':') ? 1 : p === '*' ? 0 : 3), 0)
    if (!best || score > best.score) best = { route, params, score }
  }
  return best && { route: best.route, params: best.params }
}

/** True when some registered route (other than a catch-all) handles `path`. Reactive inside components. */
export function hasRoute(path: string): boolean {
  const hit = resolveRoute(path)
  return !!hit && hit.route.path !== '*'
}

/** True when a command is registered under `id`. Reactive inside components. */
export function hasCommand(id: CommandId): boolean {
  return commands.list.value.some((c) => c.id === id)
}

/**
 * Run a command by id and return whatever it returns (a Promise for async commands). Returns `undefined` when
 * nothing is registered under that id — callers that need the feature should check `hasCommand` first.
 */
export function runCommand<K extends CommandId>(
  id: K,
  ...args: Parameters<CommandFn<K>>
): ReturnType<CommandFn<K>> | undefined {
  const cmd = commands.list.peek().find((c) => c.id === id)
  if (!cmd) return undefined
  return (cmd.run as AnyFn)(...(args as never[])) as ReturnType<CommandFn<K>>
}

const isEditable = (el: EventTarget | null) => {
  const e = el as HTMLElement | null
  return !!e && (e.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.tagName ?? ''))
}

const isMac = () => typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform)

/** Pure: `'mod+k'` matches ⌘K on Mac and Ctrl+K elsewhere; `'/'` is a bare key. */
export function shortcutMatches(
  shortcut: string,
  e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>,
  mac = isMac(),
): boolean {
  const parts = shortcut.toLowerCase().split('+')
  const key = parts.pop()
  if (!key || e.key.toLowerCase() !== key) return false
  const mod = parts.includes('mod')
  const wantCtrl = parts.includes('ctrl') || (mod && !mac)
  const wantMeta = parts.includes('meta') || (mod && mac)
  // Shift is part of producing symbols like '?' — only enforce it when the shortcut names it.
  const shiftOk = parts.includes('shift') ? e.shiftKey : !e.shiftKey || !/^[a-z0-9]$/.test(key)
  return e.ctrlKey === wantCtrl && e.metaKey === wantMeta && shiftOk && e.altKey === parts.includes('alt')
}

/** Find the command bound to a keydown event, honouring the "not while typing" rule for bare keys. */
export function commandForKey(e: KeyboardEvent): Command | undefined {
  for (const cmd of commands.list.peek()) {
    for (const s of cmd.keys ?? []) {
      if (!shortcutMatches(s, e)) continue
      if (!s.includes('+') && isEditable(e.target)) continue
      return cmd
    }
  }
  return undefined
}
