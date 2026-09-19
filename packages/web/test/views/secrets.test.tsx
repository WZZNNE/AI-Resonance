/** The delivery credentials form takes what `parseRecipients` takes; the browser's e-mail check must not block it. */
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { CredentialsSection } from '../../src/delivery/secrets.tsx'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('delivery credentials form', () => {
  it('accepts several recipients and a non-address SMTP login', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    await act(async () =>
      render(<CredentialsSection repo={{ owner: 'me', repo: 'ai-resonance' }} provider="smtp" preset="custom" />, host),
    )
    const form = host.querySelector('form') as HTMLFormElement
    const [to, user] = [...form.querySelectorAll('input')]
    await act(async () => {
      to.value = 'a@example.com, b@example.com'
      to.dispatchEvent(new Event('input', { bubbles: true }))
      user.value = 'apikey'
      user.dispatchEvent(new Event('input', { bubbles: true }))
    })
    // Neither field is a native e-mail field any more, and the form leaves validation to the component.
    expect(form.noValidate).toBe(true)
    expect([to.type, user.type]).toEqual(['text', 'text'])
    expect(to.inputMode).toBe('email')
    expect(form.checkValidity()).toBe(true)
  })
})
