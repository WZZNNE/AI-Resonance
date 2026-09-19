/**
 * Settings › Channels: where the same data is published for feed readers and AI agents (DESIGN §12). Every URL is
 * absolute, so it can be pasted into a reader or an agent's config as it is.
 */
import { apiPaths } from '@resonance/schema'
import { API_BASE } from '../core/api.ts'
import { toast } from '../core/events.ts'
import { type MessageKey, t } from '../i18n/index.ts'
import { IconButton } from '../ui/button.tsx'
import { copyText, ExtLink } from '../ui/link.tsx'
import './channels.css'

interface PublishedFile {
  label: MessageKey
  path: string
  tag?: string
}

const FILES: PublishedFile[] = [
  { label: 'channels.feed', path: API_BASE + apiPaths.feed('en'), tag: 'EN' },
  { label: 'channels.feed', path: API_BASE + apiPaths.feed('zh'), tag: '中文' },
  { label: 'channels.digest', path: API_BASE + apiPaths.digest('en'), tag: 'EN' },
  { label: 'channels.digest', path: API_BASE + apiPaths.digest('zh'), tag: '中文' },
  { label: 'channels.llms', path: `${import.meta.env.BASE_URL}llms.txt` },
  { label: 'channels.api', path: API_BASE + apiPaths.manifest },
]

/** The MCP server script inside a clone of the repository (docs/CHANNELS.md §3). */
const MCP_SCRIPT = '<repo>/packages/channels/src/mcp.ts'

/** Pure: the `mcpServers` entry that points the stdio server at this site's API. */
export function mcpConfig(apiRoot: string): string {
  const server = { command: 'node', args: [MCP_SCRIPT], env: { RESONANCE_API: apiRoot } }
  return JSON.stringify({ mcpServers: { 'ai-resonance': server } }, null, 2)
}

/** Pure: the same server added with the Claude Code CLI. */
export function mcpCommand(apiRoot: string): string {
  return `claude mcp add ai-resonance --env RESONANCE_API=${apiRoot} -- node ${MCP_SCRIPT}`
}

function absolute(path: string): string {
  return new URL(path, window.location.href).href
}

async function copy(text: string): Promise<void> {
  const ok = await copyText(text)
  toast(ok ? t('channels.copied') : t('card.copyFailed'), { kind: ok ? 'ok' : 'danger' })
}

function Snippet({ text }: { text: string }) {
  return (
    <div class="channels__snippet">
      <pre>
        <code>{text}</code>
      </pre>
      <IconButton icon="copy" size="s" label={t('channels.copy')} onClick={() => copy(text)} />
    </div>
  )
}

/** The Channels settings tab. */
export default function ChannelsTab() {
  const apiRoot = absolute(API_BASE)
  return (
    <div class="settings__stack">
      <p class="settings__hint">{t('channels.intro')}</p>
      <section class="settings__group">
        <h3 class="settings__subh">{t('channels.files')}</h3>
        <ul class="channels__list">
          {FILES.map((f) => {
            const url = absolute(f.path)
            return (
              <li key={f.path} class="channels__row">
                <span class="channels__label">
                  {t(f.label)}
                  {f.tag && <span class="channels__tag">{f.tag}</span>}
                </span>
                <ExtLink href={url} class="channels__url">
                  {url}
                </ExtLink>
                <IconButton icon="copy" size="s" label={t('card.copyLink')} onClick={() => copy(url)} />
              </li>
            )
          })}
        </ul>
      </section>
      <section class="settings__group">
        <h3 class="settings__subh">{t('channels.mcp')}</h3>
        <p class="settings__hint">{t('channels.mcpHint')}</p>
        <Snippet text={mcpCommand(apiRoot)} />
        <Snippet text={mcpConfig(apiRoot)} />
      </section>
    </div>
  )
}
