/** Leveled console logger. In GitHub Actions warnings and errors become workflow annotations. */
import type { Logger } from './types.ts'

/** Minimum severity that is printed; `silent` prints nothing. */
export type LogLevel = 'info' | 'warn' | 'error' | 'silent'

/** Options for `createLogger`; `out`/`err` exist so tests can capture lines. */
export interface LoggerOptions {
  level?: LogLevel
  /** Defaults to `process.env`; only `GITHUB_ACTIONS` is read. */
  env?: Record<string, string | undefined>
  out?: (line: string) => void
  err?: (line: string) => void
}

const RANK: Record<LogLevel, number> = { info: 0, warn: 1, error: 2, silent: 3 }

/** Workflow commands are single-line; `%`, CR and LF must be escaped or the annotation is cut short. */
function annotation(kind: 'warning' | 'error', msg: string): string {
  return `::${kind}::${msg.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')}`
}

/** Creates the logger every stage receives through `RunContext.log`. */
export function createLogger(opts: LoggerOptions = {}): Logger {
  const min = RANK[opts.level ?? 'info']
  const actions = (opts.env ?? process.env).GITHUB_ACTIONS === 'true'
  const out = opts.out ?? ((line: string) => console.log(line))
  const err = opts.err ?? ((line: string) => console.error(line))
  return {
    info(msg) {
      if (min <= RANK.info) out(msg)
    },
    warn(msg) {
      if (min <= RANK.warn) err(actions ? annotation('warning', msg) : `warn  ${msg}`)
    },
    error(msg) {
      if (min <= RANK.error) err(actions ? annotation('error', msg) : `error ${msg}`)
    },
  }
}
