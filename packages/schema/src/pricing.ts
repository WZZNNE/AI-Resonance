/**
 * Model-id normalisation shared by the pipeline (which writes `ModelPrice.k`) and the web app
 * (which matches whatever id the user typed against the catalogue).
 */

/** Exact-pass key: `Pro/deepseek-ai/DeepSeek-V3:free` → `deepseek-v3`; `claude-sonnet-4.5` → `claude-sonnet-4-5`. */
export function modelKey(id: string): string {
  let s = id.trim().toLowerCase().replace(/^~/, '')
  const colon = s.indexOf(':')
  if (colon > 0) s = s.slice(0, colon)
  s = s.slice(s.lastIndexOf('/') + 1)
  return s.replace(/[._\s]+/g, '-')
}

/** Fallback-pass key: additionally drops date stamps, `-latest`/`-preview`/`-exp` and quantisation tails. */
export function modelKeyLoose(id: string): string {
  return modelKey(id)
    .replace(/-(gguf|awq|gptq|fp8|fp16|bf16|int4|int8|q\d(-k)?(-[msl])?)$/g, '')
    .replace(/-(latest|preview|exp|experimental)$/g, '')
    .replace(/-(\d{4}-\d{2}-\d{2}|\d{8}|\d{6}|\d{4})$/g, '')
    .replace(/-(latest|preview|exp|experimental)$/g, '')
}

/** Vendor hint from an id such as `anthropic/claude-sonnet-5` → `anthropic`. */
export function modelVendorHint(id: string): string | null {
  const parts = id.trim().toLowerCase().split('/')
  return parts.length > 1 ? parts[parts.length - 2] : null
}
