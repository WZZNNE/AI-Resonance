import { render } from 'preact'
import { afterEach, expect, it } from 'vitest'
import { resetSettings } from '../../src/core/settings.ts'
import { BoardColumn } from '../../src/views/board.tsx'
import { daily } from './fixtures.ts'

let host: HTMLDivElement | undefined
afterEach(() => {
  if (host) render(null, host)
  host?.remove()
  host = undefined
})

const failing = daily(
  '2026-09-18',
  {},
  {
    sources: [{ id: 'github', board: 'repos', state: 'degraded', count: 0, message: 'rate limited' }] as never,
  },
)

it('says the reader’s filters emptied a board that had news, instead of blaming its sources', () => {
  resetSettings()
  host = document.body.appendChild(document.createElement('div'))
  render(<BoardColumn board="repos" day={failing} category={null} total={3} />, host)
  expect(host.textContent).toContain('No news matches these reading filters.')
  expect(host.textContent).not.toContain('failed')
  expect(host.querySelector('a[href="#/settings/interests"]')).not.toBeNull()
})

it('still explains a board that was empty before any filter', () => {
  resetSettings()
  host = document.body.appendChild(document.createElement('div'))
  render(<BoardColumn board="repos" day={failing} category={null} total={0} />, host)
  expect(host.textContent).toContain('This board’s sources failed for this edition:')
})
