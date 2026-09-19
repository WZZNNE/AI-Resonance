/**
 * An in-memory stand-in for the GitHub REST endpoints the mail job uses (Contents API on one branch, Issues), exposed
 * as a `fetch`. `conflicts` makes the next N content writes fail with 409 after someone else "wrote" first.
 */
export interface FakeGitHub {
  fetch: typeof fetch
  /** Current parsed state file, or null. */
  state(): unknown
  setState(value: unknown): void
  /** Queue 409 answers for the next content writes; `interloper` is written in between, like a racing run. */
  conflict(times: number, interloper?: (current: unknown) => unknown): void
  issues: Array<{ number: number; title: string; body: string; labels: string[]; state: string; comments: string[] }>
  requests: string[]
  /** Other URLs (the site, the hosted report) are answered by this. */
  fallback?: (url: string, init?: RequestInit) => Response | Promise<Response>
}

const json = (status: number, body: unknown) =>
  new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** A fake for repository `o/r` with the state file on `data`. */
export function fakeGitHub(): FakeGitHub {
  let content: string | null = null
  let sha = 0
  let pending = 0
  let interloper: ((current: unknown) => unknown) | undefined
  const fake: FakeGitHub = {
    issues: [],
    requests: [],
    state: () => (content === null ? null : JSON.parse(content)),
    setState(value) {
      content = JSON.stringify(value)
      sha++
    },
    conflict(times, fn) {
      pending = times
      interloper = fn
    },
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input))
      const method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      fake.requests.push(`${method} ${url.pathname}${url.search}`)
      if (url.host !== 'api.github.com') {
        return fake.fallback ? fake.fallback(url.href, init) : new Response('not found', { status: 404 })
      }
      const path = url.pathname.replace(/^\/repos\/o\/r/, '')
      if (path === '/contents/state/mail.json') {
        if (method === 'GET') {
          if (url.searchParams.get('ref') !== 'data') return json(404, { message: 'No commit found for the ref' })
          if (content === null) return json(404, { message: 'Not Found' })
          return json(200, { sha: `sha${sha}`, encoding: 'base64', content: Buffer.from(content).toString('base64') })
        }
        if (method === 'PUT') {
          if (body.branch !== 'data') return json(422, { message: 'Branch not found' })
          if (pending > 0) {
            pending--
            if (interloper) fake.setState(interloper(fake.state()))
            return json(409, { message: `state/mail.json does not match ${body.sha}` })
          }
          if ((content === null) !== (body.sha === undefined) || (body.sha && body.sha !== `sha${sha}`)) {
            return json(409, { message: 'sha mismatch' })
          }
          fake.setState(JSON.parse(Buffer.from(body.content, 'base64').toString('utf8')))
          return json(200, { content: { sha: `sha${sha}` } })
        }
      }
      if (path === '/issues' && method === 'GET') {
        const open = fake.issues.filter(
          (i) => i.state === 'open' && i.labels.includes(url.searchParams.get('labels') ?? ''),
        )
        return json(
          200,
          open.slice(0, 1).map((i) => ({ number: i.number, html_url: `https://github.com/o/r/issues/${i.number}` })),
        )
      }
      if (path === '/issues' && method === 'POST') {
        const issue = { number: fake.issues.length + 1, state: 'open', comments: [], ...body }
        fake.issues.push(issue)
        return json(201, { number: issue.number, html_url: `https://github.com/o/r/issues/${issue.number}` })
      }
      const m = /^\/issues\/(\d+)(\/comments)?$/.exec(path)
      const issue = m && fake.issues.find((i) => i.number === Number(m[1]))
      if (issue && m?.[2] && method === 'POST') {
        issue.comments.push(body.body)
        return json(201, {})
      }
      if (issue && method === 'PATCH') {
        issue.state = body.state
        return json(200, {})
      }
      return json(404, { message: `unhandled ${method} ${path}` })
    }) as typeof fetch,
  }
  return fake
}
