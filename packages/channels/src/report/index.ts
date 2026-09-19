/**
 * `@resonance/channels/report` — DOM-free, dependency-free report renderers (DESIGN §15.1), shared by the pipeline
 * (hosted `report/<id>.<lang>.html` files), the web app's Export view and the mail job.
 *
 *   const input = buildDailyInput(daily, manifest)          // or buildWeeklyInput(weekly, dailies, manifest)
 *   const file = renderReport(input, { lang: 'zh' })         // one self-contained interactive HTML document
 *   const mail = renderEmail(input, { lang: 'zh', reportUrl }) // { subject, html, text }
 */
/** The report's inline controller; the web app's CSP allows exactly this script by hash (Export › Preview). */
export { CONTROLLER } from './app.ts'
export { EMAIL_BUDGET, renderEmail } from './email.ts'
export type { BuildOptions } from './input.ts'
export { buildDailyInput, buildWeeklyInput } from './input.ts'
export type { ReportPayload, SlimItem } from './render.ts'
export { renderReport, reportPayload } from './render.ts'
export type {
  EmailOptions,
  RenderEmail,
  RenderedEmail,
  RenderReport,
  ReportInput,
  ReportOptions,
  ReportSection,
  UserSummary,
} from './types.ts'
