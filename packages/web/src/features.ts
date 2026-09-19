/**
 * Feature discovery: every `src/<feature>/index.ts(x)` and `src/views/more.ts` is imported for its registrations
 * (routes, settings tabs, item actions, commands). Resolved at build time, so a feature that is not there is simply
 * absent. Everything imported here lands in the initial bundle: features keep heavy code behind dynamic `import()`.
 */
import.meta.glob(['./*/index.ts', './*/index.tsx', './views/more.ts'], { eager: true })
