/**
 * The site CSP allows exactly one inline script: the report controller. Export › Preview opens the rendered report
 * from a `blob:` URL, and a blob document inherits the CSP of the page that made it, so `script-src 'self'` alone
 * would leave the preview without tabs, filters or language switch. The controller is a fixed first-party string
 * (the report data travels as inert JSON), so its hash is added at build time rather than `'unsafe-inline'`.
 */
import { createHash } from 'node:crypto'
import { CONTROLLER } from '@resonance/channels/report'

const SCRIPT_SRC = "script-src 'self'"

/** `'sha256-…'` of the report controller, as CSP writes a hash source. */
export function controllerHash(): string {
  return `'sha256-${createHash('sha256').update(CONTROLLER, 'utf8').digest('base64')}'`
}

/** `index.html` with the controller's hash added to `script-src`; throws when the CSP no longer has that directive. */
export function allowController(html: string): string {
  if (!html.includes(`${SCRIPT_SRC};`)) throw new Error(`index.html: CSP without "${SCRIPT_SRC};" to extend`)
  return html.replace(`${SCRIPT_SRC};`, `${SCRIPT_SRC} ${controllerHash()};`)
}
