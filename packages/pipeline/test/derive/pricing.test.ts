/** Runs on trimmed samples of the real models.dev and LiteLLM catalogues (`fixtures/`). */
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildPricing, MAX_PRICING_BYTES, pricingProblem, slimLiteLLM, slimModelsDev } from '../../src/pricing.ts'
import { pricingFileSchema } from '../../src/validate.ts'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const NOW = new Date('2026-09-19T07:00:00.000Z')

async function sample(name: string): Promise<unknown> {
  return JSON.parse(await readFile(join(FIXTURES, name), 'utf8'))
}

describe('pricing.json', () => {
  it('slims the catalogues into a valid v2 PricingFile well under the size limit', async () => {
    const primary = slimModelsDev(await sample('models-dev.json'))
    const missing = new Set(['cohere', 'perplexity'])
    const file = buildPricing([primary, slimLiteLLM(await sample('litellm.json'), missing, '2026-09-19')], NOW)
    expect(pricingFileSchema.safeParse(file).success).toBe(true)
    expect(file.models.length).toBeGreaterThan(0)
    expect(Buffer.byteLength(JSON.stringify(file))).toBeLessThan(MAX_PRICING_BYTES)
    expect(file.models.every((m) => file.providers[m.p])).toBe(true)
  })

  it('refuses a catalogue that grew past the limit', async () => {
    const file = buildPricing([slimModelsDev(await sample('models-dev.json'))], NOW)
    expect(pricingProblem(file)).toBeNull()
    const base = file.models[0]
    const bloated = {
      ...file,
      models: [
        ...file.models,
        ...Array.from({ length: 3000 }, (_, i) => ({ ...base, id: `${base.id}-copy-${i}`, name: 'x'.repeat(60) })),
      ],
    }
    expect(pricingProblem(bloated)).toMatch(/^\d+ bytes \(limit 300000\)$/)
  })
})
