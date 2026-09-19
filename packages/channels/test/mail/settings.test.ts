import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { MAIL_DEFAULTS, parseMailBlock, resolveMailSettings } from '../../src/mail/settings.ts'

const CONFIG = new URL('../../../../config.yaml', import.meta.url)

describe('parseMailBlock', () => {
  it('reads the mail block of the real config.yaml', async () => {
    expect(parseMailBlock(await readFile(CONFIG, 'utf8'))).toEqual({
      enabled: false,
      frequency: 'daily',
      weekday: 2,
      time: '08:30',
      timezone: 'Asia/Shanghai',
      lang: 'zh',
      provider: 'smtp',
      preset: 'qq',
      attach: true,
      perBoard: 5,
    })
  })

  it('handles quotes, comments, blank lines and stops at the next top-level key', () => {
    const yaml = [
      'site:',
      '  name: x',
      'mail:   # e-mail',
      "  time: '07:05'   # quoted",
      '',
      '  # a comment line',
      '  host: "smtp.example.com#1"',
      '  port: 587',
      '  secure: false',
      '  nested:',
      '    deep: 1',
      'pricing:',
      '  enabled: true',
    ].join('\n')
    expect(parseMailBlock(yaml)).toEqual({ time: '07:05', host: 'smtp.example.com#1', port: 587, secure: false })
    expect(parseMailBlock('site:\n  name: x\n')).toEqual({})
  })
})

describe('resolveMailSettings', () => {
  const yaml = 'mail:\n  enabled: false\n  time: "08:30"\n  lang: zh\n'

  it('layers defaults ← config.yaml ← RESONANCE_MAIL and ignores unknown keys', () => {
    expect(resolveMailSettings(null, undefined)).toEqual(MAIL_DEFAULTS)
    const s = resolveMailSettings(yaml, JSON.stringify({ v: 1, enabled: true, time: '07:15', port: '587', weekday: 5 }))
    expect(s).toEqual({ ...MAIL_DEFAULTS, enabled: true, time: '07:15', port: 587, weekday: 5 })
    expect('v' in s).toBe(false)
  })

  it('lists every invalid value in one error', () => {
    const bad = JSON.stringify({ frequency: 'hourly', timezone: 'Mars/Olympus', graceMinutes: 5, lang: 'fr' })
    expect(() => resolveMailSettings(yaml, bad)).toThrow(
      /mail\.frequency = "hourly".*\n.*mail\.timezone = "Mars\/Olympus".*\n.*mail\.lang = "fr".*\n.*mail\.graceMinutes = 5/,
    )
    expect(() => resolveMailSettings(yaml, '{"preset":"custom"}')).toThrow(/mail\.host is required/)
    expect(resolveMailSettings(yaml, '{"preset":"custom","host":"smtp.x.org"}').host).toBe('smtp.x.org')
    expect(() => resolveMailSettings(yaml, '{nope')).toThrow(/not valid JSON/)
    expect(() => resolveMailSettings(yaml, '[1]')).toThrow(/must be a JSON object/)
  })
})
