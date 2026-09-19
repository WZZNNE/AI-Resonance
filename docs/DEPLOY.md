# Deploy

Everything runs in **your** GitHub repository: two scheduled workflows and a static site. There is nothing to host.
This guide goes from zero to a running radar, then covers the optional parts: keys, custom domain, Cloudflare Pages,
e-mail and backfilling history. The public instance, <https://wzznne.github.io/AI-Resonance/>, runs exactly this
setup from [WZZNNE/AI-Resonance](https://github.com/WZZNNE/AI-Resonance).

- [1. Create your copy](#1-create-your-copy)
- [2. Turn on GitHub Pages](#2-turn-on-github-pages)
- [3. Tell the config where it lives](#3-tell-the-config-where-it-lives)
- [4. First run](#4-first-run)
- [5. Secrets and variables](#5-secrets-and-variables)
- [6. Schedule and keep-alive](#6-schedule-and-keep-alive)
- [7. Custom domain](#7-custom-domain)
- [8. Cloudflare Pages instead of GitHub Pages](#8-cloudflare-pages-instead-of-github-pages)
- [9. Scheduled e-mail](#9-scheduled-e-mail)
- [10. Backfill history](#10-backfill-history)
- [11. Updating your copy](#11-updating-your-copy)
- [12. Troubleshooting](#12-troubleshooting)

## 1. Create your copy

On the project's GitHub page, [WZZNNE/AI-Resonance](https://github.com/WZZNNE/AI-Resonance): **Use this template →
Create a new repository**. Pick an owner and a name (`ai-resonance` is fine) and leave **Include all branches**
unticked. You want a fresh `data` branch, not someone else's snapshots.

Use a template copy rather than a fork. Forks start with Actions disabled, and GitHub sends failure mail for
scheduled runs to whoever last edited the cron line. If you did fork, open the **Actions** tab and click
**I understand my workflows, go ahead and enable them**.

Keep the repository **public** unless you have paid Actions minutes. See [Costs](../README.md#costs-and-limits-honest-version).

## 2. Turn on GitHub Pages

**Settings → Pages → Build and deployment → Source → GitHub Actions.**

That is the only required switch. The `Daily` workflow builds the site and deploys it with
`actions/deploy-pages`. No `gh-pages` branch is involved.

## 3. Tell the config where it lives

The shipped `config.yaml` points at the original project (`WZZNNE/AI-Resonance` and its site). In your copy, edit
`config.yaml` on the default branch:

```yaml
site:
  repoUrl: https://github.com/<you>/<repo>   # footer link, Settings › Delivery, honest User-Agent strings
  siteUrl: ''                                # empty: CI derives your Pages URL
sources:
  reddit:
    username: ''                             # your Reddit name, if you have one: goes into the User-Agent Reddit asks for
```

With `site.siteUrl` empty, the workflow derives `https://<you>.github.io/<repo>/`, or uses the `SITE_URL` variable
(§5). Set it only for a fixed public URL; it wins over the variable.

## 4. First run

**Actions → Daily → Run workflow → Run workflow.**

The job:

1. installs dependencies (`pnpm install --frozen-lockfile`);
2. checks out the `data` branch into `./data`, or starts an empty orphan `data` branch on the very first run;
3. runs `pnpm daily`: collects every enabled source, files each item into its edition, ranks, writes LLM copy if a
   key is set, fetches the price catalogue, and publishes `/api/v1`;
4. commits `data/` (snapshots, caches, source state) to the `data` branch;
5. runs `pnpm build` and deploys `packages/web/dist` to Pages.

The first run can take up to half an hour. Most of that is Reddit's RSS feed, which allows about one request a minute.
Later runs reuse Reddit results for `minIntervalHours` (6 h) and are much shorter. When it finishes, the run summary
shows the site URL, `https://<you>.github.io/<repo>/`.

What to expect on day one:

- **Repos.** Star gains are measured between two of our own snapshots. Until a second snapshot exists, a repo shows
  GitHub Trending's own "stars today" (the score breakdown says `via trending-page`).
- **Labs.** Posts with a date appear immediately. Undated changelog entries present on the first read are only
  recorded ("seeded") so that old entries are not announced as news. From the second run on, new ones appear.
- **Live vs. closed.** The open edition shows as *Live*. The first closed edition (`daily/<date>.json`) appears after
  the next Pacific midnight, and it settles 8 h later.
- **Trends** (streaks, sparklines, `BACK`) fill in as days accumulate. To start with history, see
  [§10 Backfill](#10-backfill-history).

A step called **Fail when every source failed** marks the run red only when *no* source produced anything. The data
and the site are still committed and deployed, so the outage is visible on the site. A single failed source only shows
as a status chip on that board.

## 5. Secrets and variables

All optional. **Settings → Secrets and variables → Actions**. Secrets go in the **Secrets** tab and variables in the
**Variables** tab, both as *repository* entries.

### Secrets

| Name | Used by | What it enables |
|---|---|---|
| `RESONANCE_LLM_API_KEY` | Daily | LLM copy: bilingual title/blurb/"why it matters", 2–3 essence points for top items, the edition brief and the weekly brief |
| `RESONANCE_LLM_BASE_URL` | Daily | OpenAI-compatible base URL; default `config.yaml › enrich.baseUrl` (`https://api.deepseek.com`) |
| `RESONANCE_LLM_MODEL` | Daily | model id; default `config.yaml › enrich.model`. Check your provider's current ids |
| `X_BEARER_TOKEN` | Daily | X, `provider: xapi` (official pay-per-use API) |
| `TWITTERAPI_IO_KEY` | Daily | X, `provider: twitterapi_io` (unofficial) |
| `SOCIALDATA_API_KEY` | Daily | X, `provider: socialdata` (unofficial) |
| `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` | Daily | Reddit OAuth (`client_credentials`) with real votes and comment counts. Needs an app Reddit has approved |
| `MAIL_TO` | Mail | recipients, comma-separated |
| `SMTP_USER`, `SMTP_PASS` | Mail | the sending mailbox (full address) and its SMTP code: QQ/163 授权码 or a Gmail app password |
| `RESEND_API_KEY` | Mail | the alternative to SMTP |

With the shipped `sources.x` (`enabled: true`, `provider: auto`), adding one of the X keys is all it takes: the next
run uses the first provider whose secret is set, in the order above, for the whole watch list. If you pin a `provider`
in `config.yaml`, only that provider's key counts. See [SOURCES.md › X](./SOURCES.md#x) for prices and the
spending-limit advice.

### Variables

| Name | Used by | Value |
|---|---|---|
| `RESONANCE_MAIL` | Mail | JSON with the keys of `config.yaml › mail` (§9) |
| `BASE_PATH` | Daily, Mail | site base path. Default `/<repo>/`, or `/` for a `<you>.github.io` repository. Set `/` for a custom domain or Cloudflare Pages |
| `SITE_URL` | Daily, Mail | public URL with a trailing slash, used by e-mail links, feeds, `llms.txt` and the manifest. Default `https://<you>.github.io<BASE_PATH>` |
| `RESEND_FROM` | Mail | sender address on a domain you verified in Resend (default `onboarding@resend.dev`) |

`site.siteUrl` in `config.yaml`, when set, wins over `SITE_URL` for the pipeline's own files. The mail workflow reads
only the variable, so if you set both, keep them identical.

## 6. Schedule and keep-alive

| Workflow | When (UTC) | Why |
|---|---|---|
| `daily.yml` | `40 */3 * * *` and `40 7,8 * * *` | every 3 h, plus a run just after the Pacific midnight cutoff in both summer (07:00 UTC) and winter (08:00 UTC) |
| `mail.yml` | `7,37 * * * *` | a gate job decides in seconds whether a mail is due, and only then installs and sends |
| `ci.yml` | on push and pull request | `pnpm check` + `pnpm build` |

`pnpm daily` works out from the clock which edition is open, which one just closed and which one is due to settle, so
late or skipped cron runs do not corrupt anything. GitHub's cron is often 15 min to 2 h late and may drop runs at
busy times. Runs are placed off the hour on purpose.

GitHub disables scheduled workflows in a public repository after **60 days without activity**. Both scheduled
workflows call `gh api -X PUT …/actions/workflows/<file>/enable` on Mondays, which resets the timer (community-proven,
not documented). If a workflow was disabled anyway, re-enable it under **Actions → (workflow) → Enable workflow**.

To pause the radar, disable **Daily** (and **Mail**) in the Actions tab.

## 7. Custom domain

1. **Settings → Pages → Custom domain**: enter e.g. `radar.example.com` → **Save**. With Actions-based deployment no
   `CNAME` file is needed.
2. DNS at your registrar:
   - subdomain: a `CNAME` record `radar` → `<you>.github.io`;
   - apex domain: `A` records `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153` (and
     optionally `AAAA` `2606:50c0:8000::153` … `2606:50c0:8003::153`).
3. Once the certificate is issued, tick **Enforce HTTPS**.
4. Set the repository variables `BASE_PATH` = `/` and `SITE_URL` = `https://radar.example.com/`, then run **Daily**
   once.

A custom domain also gives the site its own browser origin, which removes the shared-`github.io`-origin caveat for
keys stored in the browser.

## 8. Cloudflare Pages instead of GitHub Pages

The pipeline stays in GitHub Actions. Only the deploy step changes.

1. In the Cloudflare dashboard, create a Pages project that uses **Direct Upload** (Workers & Pages → Create → Pages)
   and note its name and production branch.
2. Create an API token (**My Profile → API Tokens → Create Token → Custom token**) with the permission
   **Account · Cloudflare Pages · Edit**. Copy your **Account ID** from the dashboard.
3. Add the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
4. In your copy of `.github/workflows/daily.yml`, replace the steps **Upload the Pages artifact** and **Deploy to
   GitHub Pages** with:

   ```yaml
         - name: Deploy to Cloudflare Pages
           uses: cloudflare/wrangler-action@v4
           with:
             apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
             accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
             command: pages deploy packages/web/dist --project-name=<your-project> --branch=<production-branch>
   ```

   Also delete the job's `environment:` block and the `pages: write` and `id-token: write` permissions. Only GitHub
   Pages needs them.
5. Set the variables `BASE_PATH` = `/` and `SITE_URL` = `https://<your-project>.pages.dev/` (or your custom domain on
   Cloudflare).

The app uses a hash router, so no rewrite rules are needed on any static host.

## 9. Scheduled e-mail

A mail per edition (daily), per ISO week (weekly, on a weekday you pick), or both. It is sent at your local time from
your own mailbox, with the brief, the top items of every board, a link to the hosted interactive report and the same
report attached. How the gate decides is described in [CHANNELS.md › Scheduled e-mail](./CHANNELS.md#6-scheduled-e-mail).

### 9.1 Get an SMTP code for the sending mailbox

| Mailbox | Where | `preset` | `SMTP_USER` / `SMTP_PASS` |
|---|---|---|---|
| **QQ Mail** | mail.qq.com → click your avatar → **设置 → 账号与安全 → 安全设置** → turn on the **POP3/IMAP/SMTP** service → **生成授权码** (confirm by SMS if asked) | `qq` (smtp.qq.com:465) | full QQ address / the 授权码 |
| **163 Mail** | mail.163.com → **设置 → POP3/SMTP/IMAP** → **开启** the IMAP/SMTP service → create a **授权码** | `163` (smtp.163.com:465) | full 163 address / the 授权码 |
| **Gmail** | Google Account → **Security → 2-Step Verification** (turn it on) → **App passwords** → create one | `gmail` (smtp.gmail.com:465) | full Gmail address / the 16-character app password |
| **Resend** | resend.com → **API Keys** → create | `provider: resend` | secret `RESEND_API_KEY` |

- Changing the mailbox password revokes the QQ 授权码 and Gmail app passwords. Create new ones afterwards.
- Gmail app passwords do not exist for Workspace (work/school) accounts, for Advanced Protection, or when 2-Step
  Verification uses security keys only.
- 163 sometimes rejects mail as spam (`554 DT:SPM`). Keep the default subject and do not send in bursts.
- **Outlook.com / Hotmail cannot send** over SMTP with a password any more (OAuth only). They work fine as recipients.
- Resend without a verified domain sends from `onboarding@resend.dev` and **only to the address you signed up with**.
  To send elsewhere, verify a domain in Resend and set the variable `RESEND_FROM` to an address on it. The free plan
  allows 100 mails/day.
- Other SMTP servers: `"preset":"custom","host":"smtp.example.com","port":465,"secure":true`.

### 9.2 Option A: set it up from the app (Settings › Delivery)

The Delivery tab writes the variable and the secrets through GitHub's API. It needs a **fine-grained personal access
token** that can touch only this repository:

1. GitHub → your avatar → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate
   new token** (direct link: <https://github.com/settings/personal-access-tokens/new>).
2. **Repository access → Only select repositories →** your copy.
3. **Permissions → Repository permissions:**
   - **Actions:** Read and write (the "Send test now" button),
   - **Secrets:** Read and write,
   - **Variables:** Read and write.

   **Metadata: Read-only** is added automatically. Nothing else is needed.
4. Pick an expiration, generate, and paste the token into the Delivery tab. It is stored in the credential vault.

Fill in recipients, send time, timezone, frequency, language and mailbox. The page encrypts each secret in your
browser (libsodium sealed box against the repository's public key) before uploading it. It can write secrets but can
never read them back. **Send test now** triggers the Mail workflow with `test: true`. The status line comes from
`api/v1/mail-status.json`, which never contains addresses.

### 9.3 Option B: by hand

**Settings → Secrets and variables → Actions**:

- secrets `MAIL_TO`, and `SMTP_USER` + `SMTP_PASS` (or `RESEND_API_KEY`);
- variable `RESONANCE_MAIL`, for example

  ```json
  {"enabled":true,"frequency":"daily","time":"08:30","timezone":"Asia/Shanghai","lang":"zh","preset":"qq"}
  ```

Keys you leave out come from `config.yaml › mail`. Every key is listed in
[CUSTOMIZE.md › mail](./CUSTOMIZE.md#mail-e-mail-defaults).

### 9.4 Test and check

**Actions → Mail → Run workflow**, tick **test**, and run it. The newest edition is sent immediately and nothing is
recorded. Check the inbox **and the spam folder**. Other inputs: `force` sends now even if already sent, and `slot`
sends a given `YYYY-MM-DD` or `YYYY-Www`.

When a send fails, the run is red, the error (scrubbed of addresses and secrets) is recorded in `state/mail.json`, and
an issue labelled **`mail-failure`** is opened or commented on. The next successful send closes it.

Which edition does a mail carry? The newest one that had *closed* at your send time. With the defaults (Pacific
editions, 08:30 Beijing) that is the edition from two calendar days earlier, the newest complete one. If the edition
has not settled yet, the mail says *preliminary*.

## 10. Backfill history

Some sources can answer for past windows, so you can start with a few weeks of history instead of one day. Papers
come from Hugging Face's daily lists, news from Algolia (the exact edition window with final points), and labs from
each site's recent posts. **Repos and Social cannot be backfilled**: GitHub keeps no per-day star history, and X and
Reddit only serve recent posts. Boards that already have data are never replaced.

Backfilling runs on your machine against a checkout of the `data` branch. Do it right after a Daily run has finished,
so the two do not race:

```bash
git clone https://github.com/<you>/<repo> && cd <repo>
pnpm i
git fetch origin data
git worktree add data origin/data         # ./data is git-ignored on the default branch
git -C data checkout -B data
export GITHUB_TOKEN=<a token>             # optional but recommended (rate limits)
pnpm pipeline backfill --days 14
pnpm publish:data                         # optional: rebuild /api/v1 locally to look at the result with pnpm dev
git -C data add -A && git -C data commit -m "data: backfill" && git -C data push origin data
```

The next Daily run publishes the backfilled editions.

## 11. Updating your copy

A template copy has no link to the original repository. To pull improvements:

```bash
git remote add upstream https://github.com/WZZNNE/AI-Resonance.git
git fetch upstream
git merge upstream/main          # resolve conflicts in config.yaml by keeping your topic/weights
```

Your data lives on the `data` branch and is not touched. Snapshots are migrated for free: `/api/v1` is rebuilt from
them on every run (DESIGN §2.1).

## 12. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Site is 404 | Pages source is not **GitHub Actions** (§2), or the first Daily run has not finished. |
| Site loads, styles and scripts 404 | Wrong `BASE_PATH`: `/` for custom domains, Cloudflare Pages and `<you>.github.io` repositories, `/<repo>/` otherwise. |
| "Deploy to GitHub Pages" fails with an environment protection error | **Settings → Environments → github-pages**: allow the default branch to deploy. |
| Daily is red, every chip says *failed* | A network-wide problem on the runner. Re-run the job, and run `pnpm pipeline doctor` locally to see which endpoints answer. |
| Reddit shows *stale* | Reddit blocked the runner's IP (`blocked by network security`). It usually clears on a later run (new runner, new IP). |
| Labs source *degraded* | Bot protection (x.ai) or a slow China-hosted site. The fallback strategy was used, and the chip says which. |
| No briefs or bilingual copy | `RESONANCE_LLM_API_KEY` is missing, or the model id is wrong. Check the "Collect" step log, or run `pnpm pipeline doctor` locally with the key set. |
| No e-mail | `RESONANCE_MAIL` has `"enabled":false` or invalid JSON (the gate logs the reason). Also check the spam folder and the `mail-failure` issue (§9.4). |
| Scheduled runs stopped | 60-day inactivity rule (§6). Re-enable the workflow in the Actions tab. |
