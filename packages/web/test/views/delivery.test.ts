import { blake2b } from '@noble/hashes/blake2.js'
import nacl from 'tweetnacl'
import { describe, expect, it } from 'vitest'
import {
  defaultMailForm,
  mailProblems,
  parseMailVariable,
  parseRecipients,
  parseRepo,
  presetForAddress,
  secretsToWrite,
  serializeMailVariable,
} from '../../src/delivery/form.ts'
import { createGitHubApi, GitHubApiError } from '../../src/delivery/github.ts'
import { type DeliveryPrefs, vetImport } from '../../src/delivery/prefs.ts'
import {
  fromBase64,
  loadPrimitives,
  type SealPrimitives,
  sealNonce,
  sealWith,
  toBase64,
} from '../../src/delivery/seal.ts'
import { DeliveryError, describeFailure } from '../../src/delivery/session.ts'

const defaults = defaultMailForm('zh', 'Asia/Shanghai')

describe('RESONANCE_MAIL (de)serialisation', () => {
  it('defaults follow the reader: language, timezone and a matching mailbox preset', () => {
    expect(defaults).toMatchObject({
      enabled: false,
      frequency: 'daily',
      weekday: 1,
      time: '08:30',
      timezone: 'Asia/Shanghai',
      lang: 'zh',
      preset: 'qq',
    })
    expect(defaultMailForm('en', 'America/New_York')).toMatchObject({
      lang: 'en',
      preset: 'gmail',
      timezone: 'America/New_York',
    })
    expect(defaultMailForm('en', 'Not/AZone').timezone).toBe('UTC')
  })

  it('writes every key of config.yaml › mail in a stable order', () => {
    const json = serializeMailVariable({ ...defaults, enabled: true, time: '07:05' })
    expect(json).toBe(
      '{"enabled":true,"frequency":"daily","weekday":1,"time":"07:05","timezone":"Asia/Shanghai","lang":"zh","provider":"smtp",' +
        '"preset":"qq","host":"smtp.qq.com","port":465,"secure":true,"attach":true,"perBoard":5,"graceMinutes":240}',
    )
  })

  it('keeps a custom server and normalises the named presets', () => {
    const custom = JSON.parse(
      serializeMailVariable({ ...defaults, preset: 'custom', host: ' smtp.example.org ', port: 587, secure: false }),
    )
    expect(custom).toMatchObject({ preset: 'custom', host: 'smtp.example.org', port: 587, secure: false })
    const gmail = JSON.parse(serializeMailVariable({ ...defaults, preset: 'gmail', host: 'junk', port: 1 }))
    expect(gmail).toMatchObject({ host: 'smtp.gmail.com', port: 465, secure: true })
  })

  it('round-trips: parse(serialize(form)) is the form', () => {
    const form = {
      ...defaults,
      enabled: true,
      frequency: 'both' as const,
      weekday: 5,
      time: '21:45',
      lang: 'en' as const,
      perBoard: 3,
      attach: false,
    }
    const back = parseMailVariable(serializeMailVariable(form), defaultMailForm('en', 'UTC'))
    expect(back.problems).toEqual([])
    expect(back.form).toEqual({ ...form, host: 'smtp.qq.com' })
  })

  it('reads what the GitHub UI or an older page wrote: string numbers, partial objects, unknown keys', () => {
    const r = parseMailVariable(
      '{"enabled":true,"weekday":"3","port":"587","perBoard":"7","freq":"weekly","v":1}',
      defaults,
    )
    expect(r.problems).toEqual([])
    expect(r.form).toMatchObject({ enabled: true, weekday: 3, port: 587, perBoard: 7, frequency: 'daily' })
  })

  it('replaces values the mail job would reject and reports them', () => {
    const r = parseMailVariable(
      '{"time":"8:30","timezone":"Mars/Olympus","weekday":9,"perBoard":0,"lang":"fr","enabled":"yes"}',
      defaults,
    )
    expect(r.problems.sort()).toEqual(['enabled', 'lang', 'perBoard', 'time', 'timezone', 'weekday'])
    expect(r.form).toEqual(defaults)
  })

  it('treats empty or broken JSON as "not set" / "invalid"', () => {
    expect(parseMailVariable('', defaults)).toEqual({ form: defaults, problems: [] })
    expect(parseMailVariable(null, defaults)).toEqual({ form: defaults, problems: [] })
    expect(parseMailVariable('{nope', defaults).problems).toEqual(['json'])
    expect(parseMailVariable('[1,2]', defaults).problems).toEqual(['json'])
  })

  it('validates like the job, including the custom-host rule', () => {
    expect(mailProblems(defaults)).toEqual([])
    expect(mailProblems({ ...defaults, time: '24:00', port: 70000 })).toEqual(['time', 'port'])
    expect(mailProblems({ ...defaults, preset: 'custom', host: '  ' })).toEqual(['host'])
    expect(mailProblems({ ...defaults, preset: 'custom', host: '', provider: 'resend' })).toEqual([])
  })
})

describe('credentials', () => {
  it('splits, validates and de-duplicates recipients', () => {
    expect(parseRecipients('a@qq.com, B@163.com;b@163.com  c@x.io，bad, @x.io')).toEqual({
      valid: ['a@qq.com', 'B@163.com', 'c@x.io'],
      invalid: ['bad', '@x.io'],
    })
  })

  it('writes only filled-in secrets, in the format the job reads', () => {
    const c = { to: 'a@qq.com; b@qq.com', smtpUser: ' me@qq.com ', smtpPass: 'abcd efgh ijkl mnop', resendKey: 're_x' }
    expect(secretsToWrite('smtp', c)).toEqual([
      { name: 'MAIL_TO', value: 'a@qq.com,b@qq.com' },
      { name: 'SMTP_USER', value: 'me@qq.com' },
      { name: 'SMTP_PASS', value: 'abcdefghijklmnop' },
    ])
    expect(secretsToWrite('resend', c)).toEqual([
      { name: 'MAIL_TO', value: 'a@qq.com,b@qq.com' },
      { name: 'RESEND_API_KEY', value: 're_x' },
    ])
    expect(secretsToWrite('smtp', { to: '', smtpUser: '', smtpPass: '  ', resendKey: '' })).toEqual([])
  })

  it('guesses the preset from a mailbox address', () => {
    expect(presetForAddress('me@QQ.com')).toBe('qq')
    expect(presetForAddress('me@foxmail.com')).toBe('qq')
    expect(presetForAddress('me@163.com')).toBe('163')
    expect(presetForAddress('me@gmail.com')).toBe('gmail')
    expect(presetForAddress('me@outlook.com')).toBeNull()
  })

  it('parses a repository from the manifest URL or owner/name', () => {
    expect(parseRepo('https://github.com/example/ai-resonance')).toEqual({ owner: 'example', repo: 'ai-resonance' })
    expect(parseRepo('https://github.com/example/ai-resonance.git/')).toEqual({
      owner: 'example',
      repo: 'ai-resonance',
    })
    expect(parseRepo(' me/radar ')).toEqual({ owner: 'me', repo: 'radar' })
    expect(parseRepo('https://gitlab.com/me/radar')).toBeNull()
    expect(parseRepo('me/../x')).toBeNull()
    expect(parseRepo('')).toBeNull()
  })
})

const primitives: SealPrimitives = {
  box: (m, n, pk, sk) => nacl.box(m, n, pk, sk),
  keyPair: () => nacl.box.keyPair(),
  blake2b: (data, outLen) => blake2b(data, { dkLen: outLen }),
}

/** libsodium's crypto_box_seal_open, written out with the same primitives. */
function sealOpen(sealed: Uint8Array, recipient: nacl.BoxKeyPair): Uint8Array | null {
  const epk = sealed.subarray(0, 32)
  const nonce = sealNonce(primitives, epk, recipient.publicKey)
  return nacl.box.open(sealed.subarray(32), nonce, epk, recipient.secretKey)
}

const bytes = (n: number, f: (i: number) => number) => Uint8Array.from({ length: n }, (_, i) => f(i))

describe('sealed box (crypto_box_seal)', () => {
  it('derives the nonce as BLAKE2b-192 of epk ‖ pk', () => {
    const epk = bytes(32, (i) => i)
    const pk = bytes(32, (i) => 255 - i)
    const expected = blake2b(Uint8Array.from([...epk, ...pk]), { dkLen: 24 })
    expect(sealNonce(primitives, epk, pk)).toEqual(expected)
    expect(expected).toHaveLength(24)
  })

  it('round-trips through box.open with the same nonce derivation', () => {
    const recipient = nacl.box.keyPair()
    const message = new TextEncoder().encode('授权码 abcd-efgh · ✓')
    const sealed = sealWith(primitives, message, recipient.publicKey)
    expect(sealed).toHaveLength(32 + message.length + 16)
    expect(new TextDecoder().decode(sealOpen(sealed, recipient)!)).toBe('授权码 abcd-efgh · ✓')
  })

  it('is fresh every time and cannot be opened with another key', () => {
    const recipient = nacl.box.keyPair()
    const m = new TextEncoder().encode('secret')
    const a = sealWith(primitives, m, recipient.publicKey)
    const b = sealWith(primitives, m, recipient.publicKey)
    expect(toBase64(a)).not.toBe(toBase64(b))
    expect(sealOpen(a, nacl.box.keyPair())).toBeNull()
    const tampered = a.slice()
    tampered[40] ^= 1
    expect(sealOpen(tampered, recipient)).toBeNull()
  })

  it('is deterministic for a fixed ephemeral key, and wipes that key after use', () => {
    const recipient = nacl.box.keyPair.fromSecretKey(bytes(32, (i) => (i * 7 + 1) & 255))
    const eph = () => nacl.box.keyPair.fromSecretKey(bytes(32, (i) => (i * 13 + 5) & 255))
    const m = new TextEncoder().encode('hello')
    const e1 = eph()
    const a = sealWith(primitives, m, recipient.publicKey, e1)
    const b = sealWith(primitives, m, recipient.publicKey, eph())
    expect(a).toEqual(b)
    expect(a.subarray(0, 32)).toEqual(eph().publicKey)
    expect(e1.secretKey.every((x) => x === 0)).toBe(true)
  })

  it('rejects a public key of the wrong size', () => {
    expect(() => sealWith(primitives, new Uint8Array(1), new Uint8Array(31))).toThrow(/32 bytes/)
  })

  it('encodes standard base64 both ways', () => {
    expect(toBase64(new TextEncoder().encode('hello'))).toBe('aGVsbG8=')
    expect(toBase64(Uint8Array.from([0xfb, 0xff, 0xbf]))).toBe('+/+/')
    expect(fromBase64(' aGVsbG8= ')).toEqual(new TextEncoder().encode('hello'))
    const b = bytes(70_000, (i) => (i * 31) & 255)
    expect(fromBase64(toBase64(b))).toEqual(b)
  })

  it('lazily loads the same primitives the page uses', async () => {
    const p = await loadPrimitives()
    const recipient = nacl.box.keyPair()
    const sealed = sealWith(p, new TextEncoder().encode('lazy'), recipient.publicKey)
    expect(new TextDecoder().decode(sealOpen(sealed, recipient)!)).toBe('lazy')
  })
})

function fakeFetch(answers: Array<[number, unknown?]>) {
  const calls: Array<{ url: string; method: string; body?: unknown; auth?: string; cache?: string }> = []
  const impl = (async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>
    calls.push({
      url,
      method: init.method ?? 'GET',
      body: init.body ? JSON.parse(init.body as string) : undefined,
      auth: headers.authorization,
      cache: init.cache,
    })
    const [status, body] = answers.shift() ?? [500]
    return new Response(status === 204 || body === undefined ? null : JSON.stringify(body), { status })
  }) as unknown as typeof fetch
  return { impl, calls }
}

describe('GitHub client', () => {
  const repo = { owner: 'me', repo: 'radar' }

  it('upserts the variable: PATCH, then POST when it does not exist', async () => {
    const f = fakeFetch([
      [404, { message: 'Not Found' }],
      [201, {}],
    ])
    const gh = createGitHubApi('tok', repo, f.impl)
    expect(await gh.setVariable('RESONANCE_MAIL', '{}')).toBe('created')
    expect(f.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'PATCH https://api.github.com/repos/me/radar/actions/variables/RESONANCE_MAIL',
      'POST https://api.github.com/repos/me/radar/actions/variables',
    ])
    expect(f.calls[1].body).toEqual({ name: 'RESONANCE_MAIL', value: '{}' })
    expect(f.calls.every((c) => c.auth === 'Bearer tok' && c.cache === 'no-store')).toBe(true)
  })

  it('reads a missing variable as null and names the permission on 403', async () => {
    const f = fakeFetch([
      [404, { message: 'Not Found' }],
      [403, { message: 'Resource not accessible by personal access token' }],
    ])
    const gh = createGitHubApi('tok', repo, f.impl)
    expect(await gh.getVariable('RESONANCE_MAIL')).toBeNull()
    const err = await gh.putSecret('MAIL_TO', 'x', 'k').catch((e) => e)
    expect(err).toBeInstanceOf(GitHubApiError)
    expect(err).toMatchObject({ status: 403, permission: 'secrets' })
    expect(describeFailure(err)).toEqual({ key: 'delivery.err.403', params: { permission: 'Secrets' } })
  })

  it('dispatches mail.yml in test mode and reads the run id', async () => {
    const f = fakeFetch([[200, { workflow_run_id: 42, html_url: 'https://github.com/me/radar/actions/runs/42' }]])
    const gh = createGitHubApi('tok', repo, f.impl)
    expect(await gh.dispatch('main', { test: 'true' })).toEqual({
      runId: 42,
      htmlUrl: 'https://github.com/me/radar/actions/runs/42',
    })
    expect(f.calls[0].body).toEqual({ ref: 'main', inputs: { test: 'true' }, return_run_details: true })
    const f204 = fakeFetch([[204]])
    expect(await createGitHubApi('tok', repo, f204.impl).dispatch('main', { test: 'true' })).toEqual({
      runId: null,
      htmlUrl: null,
    })
  })

  it('describes failures for people', () => {
    expect(describeFailure(new GitHubApiError('x', 401, 'metadata')).key).toBe('delivery.err.401')
    expect(describeFailure(new GitHubApiError('x', 404, 'actions')).key).toBe('delivery.err.noWorkflow')
    expect(describeFailure(new GitHubApiError('offline', 0, 'variables')).key).toBe('delivery.err.network')
    expect(describeFailure(new DeliveryError('delivery.test.failed', { conclusion: 'failure' }))).toEqual({
      key: 'delivery.test.failed',
      params: { conclusion: 'failure' },
    })
  })
})

describe('settings import', () => {
  const mine: DeliveryPrefs = {
    repo: null,
    credentialId: 'cred-pat',
    credentialLabel: 'PAT',
    draft: { ...defaults, preset: 'custom', host: 'smtp.mine.example', port: 587, secure: false },
  }

  it('never takes the SMTP server or a credential binding from a file', () => {
    const draft = { ...defaults, preset: 'custom', host: 'smtp.evil.example', port: 25, secure: false, time: '07:00' }
    const incoming = { draft, credentialId: 'cred-x', credentialLabel: 'x' }
    const { value, changed } = vetImport(JSON.parse(JSON.stringify(incoming)), mine)
    expect(value).not.toHaveProperty('credentialId')
    expect(value).not.toHaveProperty('credentialLabel')
    expect(value.draft).toMatchObject({ host: 'smtp.mine.example', port: 587, secure: false, time: '07:00' })
    expect(changed).toEqual(['delivery.smtp'])
  })

  it('says when the file names another repository, and is quiet for this device’s own backup', () => {
    expect(vetImport({ repo: 'evil/fork' }, mine).changed).toEqual(['delivery.repo'])
    expect(vetImport({ repo: null, draft: mine.draft }, mine).changed).toEqual([])
  })
})
