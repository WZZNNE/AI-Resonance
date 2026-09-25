/** The features' credential linkers (core/registry.ts), loaded once when the Credentials tab or its form needs them. */
import { useEffect, useState } from 'preact/hooks'
import { type CredentialLinker, credentialLinkers } from '../core/registry.ts'

export type LoadedLinker = CredentialLinker & { id: string }

const loaded = new Map<string, Promise<LoadedLinker | null>>()

/** Every registered linker, loaded (a feature whose chunk fails to load is left out). */
export function loadLinkers(): Promise<LoadedLinker[]> {
  return Promise.all(
    credentialLinkers.value.map((e) => {
      let p = loaded.get(e.id)
      if (!p) {
        p = e.load().then(
          (l) => ({ ...l, id: e.id }),
          () => null,
        )
        loaded.set(e.id, p)
      }
      return p
    }),
  ).then((list) => list.filter((l): l is LoadedLinker => !!l))
}

/** The loaded linkers; empty until they arrive. */
export function useLinkers(): LoadedLinker[] {
  const [list, setList] = useState<LoadedLinker[]>([])
  const entries = credentialLinkers.value
  useEffect(() => {
    let live = true
    void loadLinkers().then((l) => live && setList(l))
    return () => {
      live = false
    }
  }, [entries])
  return list
}
