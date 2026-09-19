/**
 * The handful of GitHub REST calls Settings › Delivery makes with the reader's fine-grained PAT (DESIGN §15.2):
 * repository variables, Actions secrets (write-only), `workflow_dispatch` of mail.yml and its run status.
 * `api.github.com` answers CORS for these with any Origin (docs/VERIFIED.md › v2 › e-mail), so no proxy.
 */
import type { RepoRef } from './form.ts'

/** Which fine-grained PAT permission an endpoint needs — named in errors so the fix is obvious. */
export type Permission = 'metadata' | 'variables' | 'secrets' | 'actions'

/** A non-2xx answer, or a network failure (`status` 0). */
export class GitHubApiError extends Error {
  readonly status: number
  readonly permission: Permission
  constructor(message: string, status: number, permission: Permission) {
    super(message)
    this.name = 'GitHubApiError'
    this.status = status
    this.permission = permission
  }
}

export interface RepoInfo {
  defaultBranch: string
  htmlUrl: string
  private: boolean
}

export interface SecretMeta {
  name: string
  updatedAt: string
}

export interface RunInfo {
  id: number
  status: string
  /** `success`, `failure`, `cancelled` … once `status` is `completed`. */
  conclusion: string | null
  htmlUrl: string
  createdAt: string
}

interface ApiRun {
  id: number
  status: string
  conclusion: string | null
  html_url: string
  created_at: string
}

const toRun = (r: ApiRun): RunInfo => ({
  id: r.id,
  status: r.status,
  conclusion: r.conclusion,
  htmlUrl: r.html_url,
  createdAt: r.created_at,
})

const API = 'https://api.github.com'
const VERSION = '2026-03-10'
export const MAIL_WORKFLOW = 'mail.yml'

/** A client for one repository, authenticated with `token`. */
export function createGitHubApi(token: string, ref: RepoRef, fetchImpl: typeof fetch = (...a) => fetch(...a)) {
  const base = `${API}/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`

  async function call<T>(
    method: string,
    path: string,
    permission: Permission,
    body?: unknown,
  ): Promise<{ status: number; data: T | null }> {
    let res: Response
    try {
      res = await fetchImpl(`${base}${path}`, {
        method,
        // Never let the HTTP cache or a service worker keep an authenticated answer.
        cache: 'no-store',
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${token}`,
          'x-github-api-version': VERSION,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch (err) {
      throw new GitHubApiError(err instanceof Error ? err.message : String(err), 0, permission)
    }
    const text = await res.text()
    if (!res.ok) {
      let message = text.slice(0, 300)
      try {
        message = (JSON.parse(text) as { message?: string }).message ?? message
      } catch {}
      throw new GitHubApiError(message || `HTTP ${res.status}`, res.status, permission)
    }
    return { status: res.status, data: text ? (JSON.parse(text) as T) : null }
  }

  return {
    ref,

    /** Default branch and visibility (Metadata: read, granted to every fine-grained token). */
    async repo(): Promise<RepoInfo> {
      const { data } = await call<{ default_branch: string; html_url: string; private: boolean }>('GET', '', 'metadata')
      return { defaultBranch: data?.default_branch ?? 'main', htmlUrl: data?.html_url ?? '', private: !!data?.private }
    },

    /** A repository variable's value, or `null` when it does not exist. */
    async getVariable(name: string): Promise<string | null> {
      try {
        const { data } = await call<{ value: string }>('GET', `/actions/variables/${name}`, 'variables')
        return data?.value ?? null
      } catch (err) {
        if (err instanceof GitHubApiError && err.status === 404) return null
        throw err
      }
    },

    /** Create or update a variable: PATCH, then POST when it does not exist yet (a create on an existing name fails). */
    async setVariable(name: string, value: string): Promise<'updated' | 'created'> {
      try {
        await call('PATCH', `/actions/variables/${name}`, 'variables', { name, value })
        return 'updated'
      } catch (err) {
        if (!(err instanceof GitHubApiError) || err.status !== 404) throw err
      }
      await call('POST', '/actions/variables', 'variables', { name, value })
      return 'created'
    },

    /** The repository's sealed-box public key for Actions secrets. */
    async publicKey(): Promise<{ keyId: string; key: string }> {
      const { data } = await call<{ key_id: string; key: string }>('GET', '/actions/secrets/public-key', 'secrets')
      if (!data?.key || !data.key_id) throw new GitHubApiError('No public key in the response', 200, 'secrets')
      return { keyId: data.key_id, key: data.key }
    },

    /** Write one secret, already encrypted for `keyId`. */
    async putSecret(name: string, encryptedValue: string, keyId: string): Promise<void> {
      await call('PUT', `/actions/secrets/${name}`, 'secrets', { encrypted_value: encryptedValue, key_id: keyId })
    },

    /** Which secrets exist (names and dates only — values can never be read back). */
    async listSecrets(): Promise<SecretMeta[]> {
      const { data } = await call<{ secrets: Array<{ name: string; updated_at: string }> }>(
        'GET',
        '/actions/secrets?per_page=100',
        'secrets',
      )
      return (data?.secrets ?? []).map((s) => ({ name: s.name, updatedAt: s.updated_at }))
    },

    /**
     * Start mail.yml by hand. With `return_run_details` GitHub answers 200 with the run id; an older API answers 204
     * without it, and the caller then looks the run up with `latestRun`.
     */
    async dispatch(
      ref: string,
      inputs: Record<string, string>,
    ): Promise<{ runId: number | null; htmlUrl: string | null }> {
      const { data } = await call<{ workflow_run_id?: number; html_url?: string }>(
        'POST',
        `/actions/workflows/${MAIL_WORKFLOW}/dispatches`,
        'actions',
        { ref, inputs, return_run_details: true },
      )
      return { runId: data?.workflow_run_id ?? null, htmlUrl: data?.html_url ?? null }
    },

    /** The newest manually started run of mail.yml. */
    async latestRun(): Promise<RunInfo | null> {
      const { data } = await call<{ workflow_runs: ApiRun[] }>(
        'GET',
        `/actions/workflows/${MAIL_WORKFLOW}/runs?event=workflow_dispatch&per_page=1`,
        'actions',
      )
      const r = data?.workflow_runs?.[0]
      return r ? toRun(r) : null
    },

    /** One run's status. */
    async run(id: number): Promise<RunInfo> {
      const { data } = await call<ApiRun>('GET', `/actions/runs/${id}`, 'actions')
      if (!data) throw new GitHubApiError('Empty run response', 200, 'actions')
      return toRun(data)
    },

    /** A green workflow may have skipped delivery. Require the explicit acknowledgement step from mail.yml. */
    async deliveryConfirmed(id: number): Promise<boolean> {
      const { data } = await call<{ jobs: Array<{ steps?: Array<{ name: string; conclusion: string | null }> }> }>(
        'GET',
        `/actions/runs/${id}/jobs?per_page=100`,
        'actions',
      )
      return !!data?.jobs.some((job) =>
        job.steps?.some((step) => step.name === 'Mail delivery confirmed' && step.conclusion === 'success'),
      )
    },
  }
}

export type GitHubApi = ReturnType<typeof createGitHubApi>

/** Where a fine-grained personal access token is created. */
export const NEW_TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new'

/** Pure: deep links for the manual path (paste values in the GitHub UI). */
export function githubLinks(ref: RepoRef) {
  const repo = `https://github.com/${ref.owner}/${ref.repo}`
  return {
    repo,
    secrets: `${repo}/settings/secrets/actions`,
    variables: `${repo}/settings/variables/actions`,
    workflow: `${repo}/actions/workflows/${MAIL_WORKFLOW}`,
  }
}
