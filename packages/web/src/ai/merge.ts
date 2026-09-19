/** Deep merge for a provider's free-form `extraBody` (DESIGN §8.2: "deep-merged last"). */

const isPlain = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)

/** Pure: `over` merged into `base`; nested objects merge, everything else (arrays, scalars, null) replaces. */
export function deepMerge(base: Record<string, unknown>, over: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(over)) {
    // `__proto__` from user JSON must not reach the prototype chain.
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue
    out[k] = isPlain(v) && isPlain(out[k]) ? deepMerge(out[k] as Record<string, unknown>, v) : v
  }
  return out
}
