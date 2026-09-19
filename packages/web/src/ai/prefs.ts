/** Startup-registered AI preferences and backup guards; no UI or SDK is loaded here. */
import type { Lang } from '@resonance/schema'
import { defineSlice } from '../core/settings.ts'
import type { Depth, Effort, Provider } from './types.ts'

export interface AiSettings {
  providers: Provider[]
  /** Selection key (`provider::model`) of the active model. */
  active: string
  /** Effort a summary starts with when the model has no default of its own. */
  effort: Effort
  /** Ask for readable reasoning and show it while streaming. */
  showThinking: boolean
  /** Summary language pinned in settings; `''` follows the UI language. */
  lang: Lang | ''
  depth: Depth
  /** "About me / what I care about", added to every summary prompt. */
  aboutMe: string
  /** Web-grounded summaries by default (needs a search API engine from the search feature). */
  web: boolean
}

export const aiPrefs = defineSlice<AiSettings>(
  'ai',
  {
    providers: [],
    active: '',
    effort: 'default',
    showThinking: false,
    lang: '',
    depth: 'brief',
    aboutMe: '',
    web: false,
  },
  // Credential ids point into this device's vault; exported settings must not carry them to another one, and an
  // imported file (untrusted: it names the endpoints) must not bind this device's keys to its providers.
  {
    redact: (v) => ({ ...v, providers: v.providers.map((p) => ({ ...p, credentialId: undefined })) }),
    importing: (incoming) => {
      if (!Array.isArray(incoming.providers)) return { value: incoming, changed: [] }
      const providers = incoming.providers.map((p) =>
        p && typeof p === 'object' ? { ...p, credentialId: undefined } : p,
      )
      return { value: { ...incoming, providers }, changed: [] }
    },
  },
)
