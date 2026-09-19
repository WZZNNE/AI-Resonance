/**
 * The few GitHub REST calls the mail job makes (Contents API for state, Issues for failures) over plain `fetch` — no
 * Octokit, and no runtime imports, because the gate uses this before dependencies are installed.
 */

/** A non-2xx answer from the GitHub API. */
export class GitHubError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'GitHubError'
    this.status = status
  }
}

/** Authenticated access to one repository. */
export interface GitHub {
  /** `owner/repo` */
  repo: string
  /** JSON request against `/repos/{repo}{path}`; resolves to the parsed body (null for 204). */
  request<T>(method: string, path: string, body?: unknown): Promise<T>
}

export interface GitHubOptions {
  token: string
  repo: string
  fetch?: typeof fetch
  apiUrl?: string
}

/** A client for `owner/repo` authenticated with `token` (the workflow's GITHUB_TOKEN). */
export function createGitHub(opts: GitHubOptions): GitHub {
  if (!/^[\w.-]+\/[\w.-]+$/.test(opts.repo)) throw new Error(`Invalid repository "${opts.repo}" — expected owner/repo`)
  const fetchImpl = opts.fetch ?? fetch
  const base = `${(opts.apiUrl ?? 'https://api.github.com').replace(/\/+$/, '')}/repos/${opts.repo}`
  return {
    repo: opts.repo,
    async request<T>(method: string, path: string, body?: unknown): Promise<T> {
      const res = await fetchImpl(`${base}${path}`, {
        method,
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${opts.token}`,
          'x-github-api-version': '2026-03-10',
          'user-agent': 'ai-resonance-mail',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      })
      const text = await res.text()
      if (!res.ok) {
        let message = text.slice(0, 300)
        try {
          message = (JSON.parse(text) as { message?: string }).message ?? message
        } catch {}
        throw new GitHubError(`GitHub ${method} ${path} → ${res.status}: ${message}`, res.status)
      }
      return (text ? JSON.parse(text) : null) as T
    },
  }
}

/** Label of the issue that tracks e-mail failures. */
export const FAILURE_LABEL = 'mail-failure'

interface Issue {
  number: number
  html_url: string
}

async function openFailureIssue(gh: GitHub): Promise<Issue | null> {
  const list = await gh.request<Issue[]>('GET', `/issues?labels=${FAILURE_LABEL}&state=open&per_page=1`)
  return list[0] ?? null
}

/**
 * Make a failure visible: comment on the open `mail-failure` issue, or open one (GitHub notifies the owner). `body` must
 * already be scrubbed of addresses and secrets.
 */
export async function reportFailure(gh: GitHub, title: string, body: string): Promise<string> {
  const open = await openFailureIssue(gh)
  if (open) {
    await gh.request('POST', `/issues/${open.number}/comments`, { body })
    return open.html_url
  }
  const created = await gh.request<Issue>('POST', '/issues', { title, body, labels: [FAILURE_LABEL] })
  return created.html_url
}

/** After a successful send, close a still-open failure issue so an open issue always means "currently broken". */
export async function resolveFailure(gh: GitHub, note: string): Promise<boolean> {
  const open = await openFailureIssue(gh)
  if (!open) return false
  await gh.request('POST', `/issues/${open.number}/comments`, { body: note })
  await gh.request('PATCH', `/issues/${open.number}`, { state: 'closed', state_reason: 'completed' })
  return true
}
