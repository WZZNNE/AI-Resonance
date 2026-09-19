/** A closed passphrase dialog keeps nothing: reopening it shows empty fields (DESIGN §8.5). */
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { resetSettings } from '../../src/core/settings.ts'
import CredentialsTab from '../../src/vault/tab.tsx'

afterEach(() => {
  resetSettings()
  document.body.innerHTML = ''
})

const passwords = () => [...document.querySelectorAll<HTMLInputElement>('input[type="password"]')]

describe('Credentials tab', () => {
  it('forgets typed passphrases when the encryption dialog is cancelled', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    await act(async () => render(<CredentialsTab />, host))
    const radios = [...host.querySelectorAll<HTMLInputElement>('input[name="vault-mode"]')]
    const encrypted = radios.find((r) => !r.checked && r.closest('label')?.textContent?.match(/encrypt|加密/i))!
    const open = async () => {
      await act(async () => {
        encrypted.click()
        encrypted.dispatchEvent(new Event('change', { bubbles: true }))
      })
    }

    await open()
    expect(passwords()).toHaveLength(2)
    await act(async () => {
      for (const input of passwords()) {
        input.value = 'correct horse battery staple'
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }
    })
    const cancel = [...document.querySelectorAll<HTMLButtonElement>('.vform button')].find((b) => b.type !== 'submit')!
    await act(async () => cancel.click())
    expect(passwords()).toHaveLength(0)

    await open()
    expect(passwords().map((i) => i.value)).toEqual(['', ''])
  })
})
