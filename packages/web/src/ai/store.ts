/**
 * The AI settings slice (providers, active model, summary preferences — never secrets: credentials are vault ids)
 * and the lazily loaded price catalogue.
 */
import { signal } from '@preact/signals'
import type { PricingFile } from '@resonance/schema'
import { api } from '../core/api.ts'
import { effortsFromPrice } from './effort.ts'
import { type EffectivePrice, effectivePrice, matchPrice, type PriceMatch } from './pricing.ts'
import { modelKeyOf } from './providers.ts'
import type { Effort, ModelRef, Provider } from './types.ts'

export { type AiSettings, aiPrefs } from './prefs.ts'

import { aiPrefs } from './prefs.ts'

/** `undefined` until loaded, `null` when the site publishes no (readable) catalogue. */
export const pricing = signal<PricingFile | null | undefined>(undefined)
let loading: Promise<PricingFile | null> | undefined

/** Fetch `pricing.json` once per page. */
export function loadPricing(): Promise<PricingFile | null> {
  loading ??= api.pricing().then(
    (f) => (pricing.value = f),
    () => (pricing.value = null),
  )
  return loading
}

export interface ModelInfo {
  match: PriceMatch | null
  price: EffectivePrice | null
  /** Allowed effort levels (besides `default`); `undefined` = unknown. */
  efforts: Effort[] | undefined
}

/** What the catalogue (plus overrides) says about one model. Reactive on `pricing`. */
export function modelInfo(p: Provider, m: ModelRef): ModelInfo {
  const file = pricing.value
  const match = file ? matchPrice(m.id, p.baseUrl, file) : null
  return {
    match,
    price: effectivePrice(m, p.baseUrl, match),
    efforts: m.efforts ?? effortsFromPrice(match?.price, m.effortStyle ?? p.effortStyle),
  }
}

const set = (providers: Provider[]) => aiPrefs.set({ providers })

/** Add a provider; it becomes active when nothing is. */
export function addProvider(p: Provider): void {
  const s = aiPrefs.value
  aiPrefs.set({
    providers: [...s.providers, p],
    active: s.active || (p.models[0] ? modelKeyOf(p.id, p.models[0].id) : ''),
  })
}

/** Patch one provider. */
export function patchProvider(id: string, patch: Partial<Provider>): void {
  set(aiPrefs.value.providers.map((p) => (p.id === id ? { ...p, ...patch } : p)))
}

/** Remove one provider. */
export function removeProvider(id: string): void {
  set(aiPrefs.value.providers.filter((p) => p.id !== id))
}

/** Patch one model of a provider. */
export function patchModel(pid: string, mid: string, patch: Partial<ModelRef>): void {
  set(
    aiPrefs.value.providers.map((p) =>
      p.id === pid ? { ...p, models: p.models.map((m) => (m.id === mid ? { ...m, ...patch } : m)) } : p,
    ),
  )
}

/** Remove one model of a provider. */
export function removeModel(pid: string, mid: string): void {
  set(aiPrefs.value.providers.map((p) => (p.id === pid ? { ...p, models: p.models.filter((m) => m.id !== mid) } : p)))
}

/** Add models to a provider, skipping ids it already has. Returns how many were new. */
export function addModels(pid: string, models: ModelRef[]): number {
  let added = 0
  set(
    aiPrefs.value.providers.map((p) => {
      if (p.id !== pid) return p
      const have = new Set(p.models.map((m) => m.id))
      const fresh = models.filter((m) => m.id.trim() && !have.has(m.id) && have.add(m.id))
      added = fresh.length
      return { ...p, models: [...p.models, ...fresh] }
    }),
  )
  return added
}
