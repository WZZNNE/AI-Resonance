# Channels

`@resonance/channels` is everything that *delivers* the published data: a typed API client, agent tools (MCP server
and a dsh seam), the interactive report renderer, and the scheduled e-mail. Contract: DESIGN §12 and §15.

The examples below read the public instance, `https://wzznne.github.io/AI-Resonance/api/v1`. Point them at your own
deployment (`https://<you>.github.io/<repo>/api/v1`) or at a local folder to use your own radar.

| Path | What |
|---|---|
| `src/client.ts` | `createClient({ baseUrl } \| { dir })` — typed readers for every `/api/v1` file |
| `src/tools.ts` | six framework-agnostic tool descriptors |
| `src/mcp.ts` | stdio MCP server over those tools |
| `src/dsh.ts` | the same tools as raw JSON-Schema definitions for dsh |
| `src/report/` | `renderReport`, `renderEmail`, `buildDailyInput`, `buildWeeklyInput` (export `@resonance/channels/report`) |
| `src/mail/` | `gate.ts` (dependency-free "is a mail due?"), `cli.ts` (`pnpm mail`), `send.ts`, `state.ts` |

## 1. API client

```ts
import { createClient } from '@resonance/channels'

const api = createClient({ baseUrl: 'https://wzznne.github.io/AI-Resonance/api/v1' }) // or { dir: 'packages/web/public/api/v1' }
const day = await api.daily()            // latest closed edition; api.daily('2026-09-18') for one day
const live = await api.live()            // the open edition, ranked so far (window.settled = false)
const week = await api.weekly()          // newest ISO week, or api.weekly('2026-W38')
const hist = await api.entity('gh:owner/repo')
const mail = await api.mailStatus()      // which e-mail slots went out, last outcome (never addresses)
```

Every reader rejects with `ApiError` (`status` 404 for a missing file). Files are cached in memory for five minutes
(`ttlMs`), and files written by a newer pipeline (`schema` above the client's) are refused with an explicit message.

## 2. Agent tools

All tools return one compact JSON value. Boards: `repos` · `papers` · `news` · `social` (X + Reddit) · `labs`
(official AI-company updates).

| Tool | Use it for | Arguments |
|---|---|---|
| `resonance_today` | what is hot today / on a date | `board`, `date` (`YYYY-MM-DD` or `"live"`), `category`, `limit`, `lang`, `includeTrend` |
| `resonance_search` | has X been trending? | `query`, `board`, `days`, `minScore`, `limit` |
| `resonance_entity` | spike or sustained trend? | `key` (or any GitHub / arXiv / HF / HN / Reddit / X / lab URL), `lang`, `includeTrend` |
| `resonance_clusters` | what echoes across sources | `date` |
| `resonance_weekly` | what mattered this week | `week`, `lang` |
| `resonance_digest` | a ready-to-quote Markdown briefing | `lang` |

Outputs carry the edition `window` (timezone, from, to, settled), the brief when the pipeline wrote one, and per item
rank, key, title, url, category, blurb, key points, score total + points per signal, board-specific metrics (social:
platform, community/handle, likes/comments only when the counts are real; labs: company, kind, surface, date, `fresh`),
trend and resonance links. A missing day or week answers `{ found: false, … }` instead of failing.

## 3. MCP server

```sh
# Claude Code
claude mcp add ai-resonance --env RESONANCE_API=https://wzznne.github.io/AI-Resonance/api/v1 -- node <repo>/packages/channels/src/mcp.ts
```

```json
{ "mcpServers": { "ai-resonance": {
  "command": "node",
  "args": ["<repo>/packages/channels/src/mcp.ts"],
  "env": { "RESONANCE_API": "https://wzznne.github.io/AI-Resonance/api/v1" }
} } }
```

`<repo>` is the path of a local clone (`git clone https://github.com/WZZNNE/AI-Resonance.git`, then `pnpm i`). The
web app's **Settings › Channels** shows both snippets with the site's own API URL filled in, next to the feed,
digest, `llms.txt` and `manifest.json` links. `RESONANCE_DIR=<folder>` reads a local `/api/v1` folder instead (it
wins when both are set). Node ≥ 22.18 runs the TypeScript source directly. Diagnostics go to stderr; stdout belongs to
the protocol.

## 4. dsh

dsh accepts raw JSON-Schema tool definitions through `ctx.tools.register()`; `createDshTools()` returns exactly that
shape (`name`, `description`, `parameters`, `execute(args, exec)` honouring `exec.signal`). The whole plugin:

```ts
// resonance-dsh/src/index.ts — an out-of-tree dsh plugin
import type { Context } from '@deepseek-ai/cordis'
import { createDshTools } from '@resonance/channels/dsh'

export const name = 'resonance'
export const inject = ['tools']

export function apply(ctx: Context) {
  for (const tool of createDshTools({ baseUrl: 'https://wzznne.github.io/AI-Resonance/api/v1' })) ctx.tools.register(tool)
}
```

Mount it through your profile patch (`$DSH_HOME/profiles/<profile>/cordis.patch.yml`: `- insert: [{ id: resonance, name:
resonance-dsh }]`) with the package resolvable from the profile, e.g. `dsh plugin --profile web add <package>`. Tools
unregister when the plugin is disposed. `@resonance/channels` has no dsh dependency.

## 5. Interactive reports

```ts
import { buildDailyInput, buildWeeklyInput, renderEmail, renderReport } from '@resonance/channels/report'

const input = buildDailyInput(daily, manifest)              // or buildWeeklyInput(weekly, dailiesOfThatWeek, manifest)
const html = renderReport(input, { lang: 'zh', preliminary: !daily.window.settled })
const mail = renderEmail(input, { lang: 'zh', reportUrl })   // { subject, html, text }
```

Everything under `report/` is pure, DOM-free and dependency-free, so the pipeline (hosted
`api/v1/report/<id>.<lang>.html`), the web app's Export view and the mail job produce identical output from the same data.

**Builders.** `buildDailyInput(daily, manifest, { now? })` takes the top N of every board in manifest order, the
edition window, brief and clusters. `buildWeeklyInput(weekly, dailies, manifest, { now? })` takes the week's top N per
board by weekly heat (N = the board's `size`), resolves each entry to its newest full item from the given editions
(entries whose editions were not passed are left out), renumbers ranks, and spans the window from the first to the last
given edition (settled only when all seven are there and settled). `generatedAt` defaults to the data's own time, so an
unchanged edition renders a byte-identical file. The web app adds `userSummaries` (its cached one-click verdicts) and may
filter `sections` before rendering.

**Options.** `lang` (initial language; both are embedded), `theme` (`auto` · `light` · `dark`), `perBoard`,
`preliminary` (banner for an unsettled edition).

**The file.** One `<!doctype html>` document: inline CSS, an inline vanilla controller (about 5 KB; a test enforces
≤ 15 KB), and the data as JSON in `<script type="application/json" id="air-data">`. Read it back with
`JSON.parse(document.getElementById('air-data').textContent)` — it equals `reportPayload(input, opts)`: the input with
sparklines and heavy per-board text (abstracts, post bodies, comments) stripped, plus the UI strings of every language.
The page is complete without JavaScript (every card, the brief and the clusters are server-rendered; item copy for the
other language sits next to it and CSS shows the active one); the controller adds board tabs + All, category chips, a
text filter, en/中文 and light/dark switches (remembered per browser), the edition window in the reader's local time,
and opens every card before printing. It works from `file://`, offline, at 360 px and on desktop, and prints cleanly.

**Safety.** Titles, summaries, LLM copy and user summaries are untrusted: every text node and attribute is escaped,
only absolute `http(s)` URLs become links (always `rel="noopener noreferrer"`), `<` inside the JSON is written as
`\u003c`, and a `Content-Security-Policy` meta tag (`default-src 'none'`) forbids any network request from the page.

**Sizes.** A worst-case five-board week (ten items per board, every text at the contract's maximum in both languages)
is about 495 KB; a typical daily report is a few hundred KB at most. The e-mail body stays under 88 KB: when it would
not, it drops essence points first and then items per board.

## 6. Scheduled e-mail

A mail per edition (daily), per ISO week (weekly on a chosen weekday), or both — sent by your own repository through
your own mailbox, with the interactive report linked and attached. No server.

### Setup

1. Create your copy with **Use this template** (forks start with Actions disabled; for a fork, enable workflows in the
   Actions tab).
2. Turn on SMTP in your mailbox and get its code — QQ: 设置 → 账号与安全 → 安全设置 → 开启服务 → 生成授权码; 163: 设置 →
   POP3/SMTP/IMAP → 开启 → 授权码; Gmail: turn on 2-Step Verification, then create an app password.
3. Settings › Delivery in the web app writes everything below with a fine-grained token (this repository only;
   Variables, Secrets and Actions read/write). By hand: *Settings → Secrets and variables → Actions*:
   - secret `MAIL_TO` — recipients, comma-separated
   - secrets `SMTP_USER` (the full mailbox address) and `SMTP_PASS` (its SMTP code) — or `RESEND_API_KEY`
   - variable `RESONANCE_MAIL`, e.g. `{"enabled":true,"time":"08:30","timezone":"Asia/Shanghai","lang":"zh","preset":"qq"}`
4. Run **Actions → Mail → Run workflow** with `test` ticked and check your inbox and spam folder.

`RESONANCE_MAIL` uses the keys of `config.yaml › mail`, which supplies the defaults:

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `false` | master switch |
| `frequency` | `daily` | `daily` · `weekly` · `both` |
| `weekday` | `1` | weekly mail day, ISO (1 = Monday) |
| `time` / `timezone` | `08:30` / `Asia/Shanghai` | your send time, in your timezone (DST handled) |
| `lang` | `zh` | `en` · `zh` (the attached report can switch) |
| `provider` | `smtp` | `smtp` · `resend` |
| `preset` | `qq` | `qq` (smtp.qq.com:465) · `163` (smtp.163.com:465) · `gmail` (smtp.gmail.com:465) · `custom` |
| `host` / `port` / `secure` | — / `465` / `true` | used with `preset: custom` |
| `attach` | `true` | attach the report as `ai-resonance-<slot>.html` |
| `graceMinutes` | `240` | how late a delayed run may still send (30–720) |
| `perBoard` | `5` | items per board in the mail body (1–10) |

Outlook.com / Hotmail cannot send over SMTP with a password any more (OAuth only): use it as a recipient, not a sender.
Resend without a verified domain sends from `onboarding@resend.dev` and only to the address you signed up with; set the
variable `RESEND_FROM` to a sender on your verified domain otherwise.

### When a mail goes out

`.github/workflows/mail.yml` runs at :07 and :37 every hour. Its first job checks out only the gate and runs it with
plain Node — no install — so a "not yet" costs seconds. The gate:

1. finds the most recent send time ≤ now in your timezone (today or yesterday; weekly only on your weekday) and is due
   only while now is within `graceMinutes` after it — GitHub's cron often runs 15 min to 2 h late;
2. picks the **slot**: the newest edition that had *closed* at your send time (weekly: the newest ISO week whose Sunday
   edition had closed). The slot names the report link `<site>/api/v1/report/<slot>.<lang>.html`, the attachment, the
   Message-ID `<air-<slot>@<owner>.github.io>` and the idempotency record. Taking it from the send time, not from "now",
   keeps it the same for every run inside the grace window;
3. skips a slot already recorded in `state/mail.json`;
4. waits while the edition is not published yet — in the last hour of the grace window it sends what exists (the open
   edition), marked *preliminary*. An edition that is published but not yet settled also goes out marked *preliminary*.

Editions follow the site's edition timezone (default US-Pacific days). Example: with the defaults, the 08:30 Beijing
mail on 19 September carries the Pacific edition of the 17th — the newest day that is complete at 08:30 in Beijing.
A Pacific reader who sets 08:30 gets yesterday's edition, marked preliminary, because editions settle `settleHours`
(default 8) after the cutoff; a send time after that gets the settled edition.

Only when the gate prints `due=<slot>` does the second job install `@resonance/channels`, render the report and the
e-mail, and send (three attempts with backoff; authentication and 5xx rejections are not retried). `state/mail.json`
on the `data` branch is then updated through the Contents API with the file's sha (a concurrent write is re-read,
merged and retried); the pipeline republishes it as `api/v1/mail-status.json`. It never contains an address.

### When it fails

The error — with addresses and secret values removed — is recorded in `state/mail.json`, an issue labelled
`mail-failure` is opened (or commented on if one is open, so you get notified once per incident), and the run fails.
The next successful send closes the issue. Workflow inputs: `test` (send the newest edition now, record nothing),
`force` (send now even if already sent; recorded, with a fresh Message-ID so your mail client does not drop it as a
duplicate), `slot` (send a given `YYYY-MM-DD` or `YYYY-Www`).

GitHub disables scheduled workflows in public repositories after 60 days without activity; the gate job re-enables
its own workflow on Mondays, which resets that timer.

### Locally

```sh
# Render into ./out instead of sending (email.html, email.txt with the subject, ai-resonance-<slot>.html)
node packages/channels/src/mail/cli.ts --dry-run out --dir packages/web/public/api/v1
node packages/channels/src/mail/cli.ts --dry-run out --slot 2026-W38        # SITE_URL=https://<you>.github.io/<repo>/
node packages/channels/src/mail/cli.ts --help
```

`pnpm mail <flags>` (no `--` separator) runs the same CLI from inside `packages/channels`, so relative paths start
there. Without `--slot`, `--test` or `--dry-run` it decides like the gate and needs `GITHUB_TOKEN` +
`GITHUB_REPOSITORY` to read the state.
