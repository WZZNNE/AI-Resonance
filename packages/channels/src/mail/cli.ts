#!/usr/bin/env node
/**
 * `pnpm mail` — render and send the scheduled e-mail (DESIGN §15.2). The workflow runs `gate.ts` first and passes the
 * slot it chose; run by hand, this makes the same decision itself.
 *
 * Failures are visible: the error (scrubbed of addresses and secrets) is recorded in state/mail.json, a GitHub issue
 * labelled `mail-failure` is opened or commented, and the exit code is 1.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import type { DailyFile, Manifest } from '@resonance/schema'
import { apiPaths } from '@resonance/schema'
import type { ResonanceClient } from '../client.ts'
import { createClient } from '../client.ts'
import { renderEmail } from '../report/email.ts'
import { byteLength } from '../report/fmt.ts'
import { buildDailyInput, buildWeeklyInput } from '../report/input.ts'
import { renderReport } from '../report/render.ts'
import { STRINGS } from '../report/strings.ts'
import type { ReportInput } from '../report/types.ts'
import { apiRoot, decide, defaultSlot, fresh, publishedFrom, readConfigText, slotKind } from './gate.ts'
import { createGitHub, reportFailure, resolveFailure } from './github.ts'
import type { Sender } from './send.ts'
import { messageId, parseRecipients, senderFromEnv, sendWithRetry } from './send.ts'
import { resolveMailSettings } from './settings.ts'
import { readState, recordError, recordSent, STATE_LOCATION, scrub, updateState } from './state.ts'

const USAGE = `Usage: pnpm mail [options]

  (no options)          decide like the scheduled gate and send if a mail is due
  --slot <id>           send this edition (2026-09-18) or week (2026-W38) now
  --test                send the newest edition now as a test; nothing is recorded
  --force               send now even if not due or already sent (recorded)
  --dry-run <folder>    write email.html, email.txt and the report there instead of sending
  --dir <api folder>    read a local /api/v1 folder instead of SITE_URL

Environment: SITE_URL, RESONANCE_MAIL, MAIL_TO, SMTP_USER + SMTP_PASS or RESEND_API_KEY [RESEND_FROM],
GITHUB_TOKEN + GITHUB_REPOSITORY (state and failure issues), DATA_BRANCH (default data).
The workflow passes MAIL_SLOT / MAIL_TEST / MAIL_FORCE instead of flags.`

/** Parsed command line (flags win over the MAIL_* variables the workflow sets). */
export interface MailArgs {
  slot?: string
  test: boolean
  force: boolean
  dryRun?: string
  dir?: string
  help: boolean
}

type Env = Record<string, string | undefined>

/** Parse flags; the workflow passes its inputs as env vars so they never pass through a shell. */
export function parseMailArgs(argv: string[], env: Env): MailArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      slot: { type: 'string' },
      test: { type: 'boolean' },
      force: { type: 'boolean' },
      'dry-run': { type: 'string' },
      dir: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
  })
  return {
    slot: values.slot ?? (env.MAIL_SLOT?.trim() || undefined),
    test: values.test ?? env.MAIL_TEST === 'true',
    force: values.force ?? env.MAIL_FORCE === 'true',
    dryRun: values['dry-run'],
    dir: values.dir,
    help: values.help ?? false,
  }
}

/** Side effects the CLI needs; injectable so the whole flow runs in tests. */
export interface MailDeps {
  fetch: typeof fetch
  now: () => Date
  log: (line: string) => void
  sleep?: (ms: number) => Promise<void>
  /** Overrides the provider chosen from settings + secrets. */
  sender?: Sender
}

function openClient(args: MailArgs, site: string | undefined, deps: MailDeps, now: Date): ResonanceClient {
  if (args.dir) return createClient({ dir: args.dir, ttlMs: 0 })
  if (!site) throw new Error('Set SITE_URL (e.g. https://you.github.io/ai-resonance/) or pass --dir <api folder>')
  const fetchFresh: typeof fetch = (input, init) => deps.fetch(fresh(String(input), now), init)
  return createClient({ baseUrl: apiRoot(site), fetch: fetchFresh, ttlMs: 0 })
}

/** The report input for a slot, and whether it must be marked preliminary. */
export async function loadSlot(
  client: ResonanceClient,
  manifest: Manifest,
  slot: string,
): Promise<{ input: ReportInput; preliminary: boolean }> {
  if (slotKind(slot) === 'daily') {
    let daily: DailyFile | null = null
    if (manifest.dates.includes(slot)) daily = await client.daily(slot)
    else {
      // Final hour of the grace window and the edition is still unpublished: the open edition is the best there is.
      const live = await client.live().catch(() => null)
      if (live?.date === slot) daily = live
    }
    if (!daily) throw new Error(`Edition ${slot} is not published (newest: ${manifest.latest || 'none'})`)
    return { input: buildDailyInput(daily, manifest), preliminary: !daily.window.settled }
  }
  if (!manifest.weeks.includes(slot)) {
    throw new Error(`Week ${slot} has no published recap (newest: ${manifest.weeks[0] ?? 'none'})`)
  }
  const weekly = await client.weekly(slot)
  const dates = manifest.dates.filter((d) => d >= weekly.from && d <= weekly.to)
  const dailies = await Promise.all(dates.map((d) => client.daily(d)))
  const input = buildWeeklyInput(weekly, dailies, manifest)
  return { input, preliminary: !input.window.settled }
}

/** Link the hosted report only if it is really there (Pages may not have it yet); the attachment covers the rest. */
async function reachable(url: string, deps: MailDeps): Promise<string | undefined> {
  try {
    const res = await deps.fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(15_000) })
    return res.ok ? url : undefined
  } catch {
    return undefined
  }
}

function issueBody(slot: string | undefined, message: string, env: Env): string {
  const run =
    env.GITHUB_RUN_ID && env.GITHUB_REPOSITORY
      ? `${env.GITHUB_SERVER_URL ?? 'https://github.com'}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
      : ''
  return [
    `The scheduled e-mail${slot ? ` for **${slot}**` : ''} could not be sent.`,
    '',
    '```',
    message,
    '```',
    run ? `Run: ${run}` : '',
    '',
    'Things to check:',
    '- SMTP: `SMTP_USER` is the full mailbox address and `SMTP_PASS` is its SMTP code (QQ / 163 授权码, Gmail app ' +
      'password). Changing the mailbox password revokes it.',
    '- Resend: `RESEND_API_KEY` is set; without a verified domain Resend only delivers to your signup address.',
    '- `MAIL_TO` is set, and the edition is published on the site.',
    '',
    'This issue is closed automatically after the next successful send.',
  ]
    .filter((line, i, all) => line !== '' || all[i - 1] !== '')
    .join('\n')
}

/** Run the mail job. Resolves to the process exit code. */
export async function runMail(args: MailArgs, env: Env, deps: MailDeps): Promise<number> {
  const now = deps.now()
  const at = now.toISOString()
  const secrets = [env.MAIL_TO, env.SMTP_USER, env.SMTP_PASS, env.RESEND_API_KEY]
  const gh =
    env.GITHUB_TOKEN && env.GITHUB_REPOSITORY
      ? createGitHub({ token: env.GITHUB_TOKEN, repo: env.GITHUB_REPOSITORY, fetch: deps.fetch })
      : null
  const location = { ...STATE_LOCATION, branch: env.DATA_BRANCH || STATE_LOCATION.branch }
  let slot = args.slot
  try {
    const settings = resolveMailSettings(await readConfigText(env), env.RESONANCE_MAIL)
    const site = env.SITE_URL?.trim() || undefined
    const client = openClient(args, site, deps, now)
    const manifest = await client.manifest()
    const published = publishedFrom(manifest)
    if (!slot) {
      if (args.test || args.force || args.dryRun) {
        slot = defaultSlot(settings, published) ?? undefined
      } else {
        if (!gh)
          throw new Error('GITHUB_TOKEN and GITHUB_REPOSITORY are needed to read state/mail.json (or pass --slot)')
        const { state } = await readState(gh, at, location)
        const decision = decide({ mail: settings, now, published, sent: state.sent })
        if (!decision.due) {
          deps.log(`skip:${decision.reason}`)
          return 0
        }
        slot = decision.slot
      }
      if (!slot) throw new Error('Nothing has been published yet')
    }
    if (!slotKind(slot)) throw new Error(`Invalid slot "${slot}" — expected YYYY-MM-DD or YYYY-Www`)

    const { input, preliminary } = await loadSlot(client, manifest, slot)
    const lang = settings.lang
    const siteUrl = site ?? manifest.site.siteUrl
    // `<siteUrl>api/v1/report/<slot>.<lang>.html`, published by the pipeline next to the data.
    const hosted = siteUrl ? new URL(apiPaths.report(slot, lang), apiRoot(siteUrl)).href : null
    const reportUrl = hosted && !args.dir ? await reachable(hosted, deps) : undefined
    const report = renderReport(input, { lang, preliminary })
    const email = renderEmail(input, { lang, preliminary, reportUrl, perBoard: settings.perBoard })
    const subject = args.test ? `${STRINGS[lang].test} ${email.subject}` : email.subject
    const attachment = { filename: `ai-resonance-${slot}.html`, content: report }
    const bytes = byteLength(email.html)

    if (args.dryRun) {
      const dir = resolve(args.dryRun)
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'email.html'), email.html)
      await writeFile(join(dir, 'email.txt'), `Subject: ${subject}\n\n${email.text}\n`)
      await writeFile(join(dir, attachment.filename), report)
      deps.log(`dry-run ${slot}${preliminary ? ' (preliminary)' : ''}: "${subject}"`)
      deps.log(`  ${join(dir, 'email.html')}  ${bytes} bytes`)
      deps.log(`  ${join(dir, 'email.txt')}  ${byteLength(email.text)} bytes`)
      deps.log(`  ${join(dir, attachment.filename)}  ${byteLength(report)} bytes`)
      return 0
    }

    const to = parseRecipients(env.MAIL_TO)
    if (!to.length) throw new Error('The MAIL_TO secret is not set (comma-separated addresses)')
    const sender = deps.sender ?? senderFromEnv(settings, env)
    const owner = env.GITHUB_REPOSITORY_OWNER || env.GITHUB_REPOSITORY?.split('/')[0] || 'ai-resonance'
    // Manual re-sends need fresh ids, or mail clients and Resend drop them as duplicates of the first delivery.
    const unique = args.test || args.force ? String(now.getTime()) : undefined
    const result = await sendWithRetry(
      sender,
      {
        fromName: manifest.site.name,
        to,
        subject,
        html: email.html,
        text: email.text,
        messageId: messageId(slot, owner, unique),
        idempotencyKey: `air-${slot}${unique ? `-${unique}` : ''}`,
        attachment: settings.attach ? attachment : undefined,
      },
      { sleep: deps.sleep },
    )
    deps.log(
      `sent ${slot} via ${sender.provider} to ${to.length} recipient(s), attempt ${result.attempts}, ${bytes} bytes`,
    )

    if (gh && !args.test) {
      const sentSlot = slot
      await updateState(gh, (s) => recordSent(s, sentSlot, { at, provider: sender.provider, bytes }), {
        now: at,
        message: `mail: sent ${sentSlot}`,
        location,
      })
    }
    if (gh) await resolveFailure(gh, `Delivered ${slot} at ${at}.`).catch(() => false)
    return 0
  } catch (err) {
    const message = scrub(err instanceof Error ? err.message : String(err), secrets)
    deps.log(`mail failed${slot ? ` (${slot})` : ''}: ${message}`)
    if (gh && !args.dryRun) {
      if (!args.test) {
        await updateState(gh, (s) => recordError(s, at, message), {
          now: at,
          message: 'mail: record failure',
          location,
        }).catch((e: Error) => deps.log(`could not record the failure: ${scrub(e.message, secrets)}`))
      }
      await reportFailure(gh, 'E-mail delivery failed', issueBody(slot, message, env))
        .then((url) => deps.log(`reported in ${url}`))
        .catch((e: Error) => deps.log(`could not open an issue: ${scrub(e.message, secrets)}`))
    }
    return 1
  }
}

if (import.meta.main) {
  let args: MailArgs
  try {
    args = parseMailArgs(process.argv.slice(2), process.env)
  } catch (err) {
    console.error(`${(err as Error).message}\n\n${USAGE}`)
    process.exit(2)
  }
  if (args.help) {
    console.log(USAGE)
    process.exit(0)
  }
  const code = await runMail(args, process.env, { fetch, now: () => new Date(), log: (line) => console.log(line) })
  process.exit(code)
}
