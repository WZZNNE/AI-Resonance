/**
 * Namespaced key/value storage for anything bigger than settings (summary cache, search index copies …).
 * IndexedDB when available, localStorage when not, memory as the last resort — and a backend that starts
 * failing mid-session is abandoned for the next one, so callers never see a throw from `get`/`set`.
 * Values are JSON on every backend, so behaviour is identical wherever the data lands.
 */

export interface KvBackend {
  get(key: string): Promise<string | undefined>
  set(key: string, json: string): Promise<void>
  del(key: string): Promise<void>
  keys(prefix: string): Promise<string[]>
}

export interface Kv {
  get<T>(key: string): Promise<T | undefined>
  /** Resolves `false` when the value could not be stored (quota, private mode). */
  set(key: string, value: unknown): Promise<boolean>
  del(key: string): Promise<void>
  keys(): Promise<string[]>
  clear(): Promise<void>
}

/** In-memory backend: survives only the page session. */
export function memoryBackend(): KvBackend {
  const map = new Map<string, string>()
  return {
    async get(key) {
      return map.get(key)
    },
    async set(key, json) {
      map.set(key, json)
    },
    async del(key) {
      map.delete(key)
    },
    async keys(prefix) {
      return [...map.keys()].filter((k) => k.startsWith(prefix))
    },
  }
}

/** `localStorage` / `sessionStorage` backend. */
export function webStorageBackend(store: Storage, prefix = 'resonance.kv:'): KvBackend {
  return {
    async get(key) {
      return store.getItem(prefix + key) ?? undefined
    },
    async set(key, json) {
      store.setItem(prefix + key, json)
    },
    async del(key) {
      store.removeItem(prefix + key)
    },
    async keys(sub) {
      const out: string[] = []
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i)
        if (k?.startsWith(prefix + sub)) out.push(k.slice(prefix.length))
      }
      return out
    },
  }
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })
}

/** IndexedDB backend: one database, one object store, string keys and JSON string values. */
export function idbBackend(dbName = 'resonance', storeName = 'kv'): KvBackend {
  let dbPromise: Promise<IDBDatabase> | undefined
  const open = () => {
    dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(storeName)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
      req.onblocked = () => reject(new Error('IndexedDB open blocked'))
    })
    return dbPromise
  }
  const tx = async (mode: IDBTransactionMode) => (await open()).transaction(storeName, mode).objectStore(storeName)
  return {
    async get(key) {
      const v = await idbRequest((await tx('readonly')).get(key))
      return typeof v === 'string' ? v : undefined
    },
    async set(key, json) {
      await idbRequest((await tx('readwrite')).put(json, key))
    },
    async del(key) {
      await idbRequest((await tx('readwrite')).delete(key))
    },
    async keys(prefix) {
      const range = IDBKeyRange.bound(prefix, `${prefix}￿`)
      return (await idbRequest((await tx('readonly')).getAllKeys(range))).map(String)
    },
  }
}

/** Try each backend in order; the first one that fails an operation is dropped for good. */
export function fallbackBackend(backends: KvBackend[]): KvBackend {
  let i = 0
  const run = async <T>(op: (b: KvBackend) => Promise<T>): Promise<T> => {
    for (; i < backends.length; i++) {
      try {
        return await op(backends[i])
      } catch (err) {
        if (i === backends.length - 1) throw err
        console.warn('[storage] backend failed, falling back', err)
      }
    }
    throw new Error('no storage backend')
  }
  return {
    get: (k) => run((b) => b.get(k)),
    set: (k, v) => run((b) => b.set(k, v)),
    del: (k) => run((b) => b.del(k)),
    keys: (p) => run((b) => b.keys(p)),
  }
}

function safeLocalStorage(): Storage | undefined {
  try {
    const s = globalThis.localStorage
    const probe = '__resonance_probe__'
    s.setItem(probe, '1')
    s.removeItem(probe)
    return s
  } catch {
    return undefined
  }
}

/** The environment's best available chain: IndexedDB → localStorage → memory. */
export function pickBackend(): KvBackend {
  const chain: KvBackend[] = []
  if (typeof indexedDB !== 'undefined') chain.push(idbBackend())
  const ls = safeLocalStorage()
  if (ls) chain.push(webStorageBackend(ls))
  chain.push(memoryBackend())
  return fallbackBackend(chain)
}

let defaultBackend: KvBackend | undefined

/** A namespaced store. Keys are scoped to `namespace`, values are JSON round-tripped. */
export function kv(namespace: string, backend?: KvBackend): Kv {
  if (!backend) defaultBackend ??= pickBackend()
  const b = backend ?? defaultBackend!
  const scope = `${namespace}/`
  return {
    async get(key) {
      try {
        const raw = await b.get(scope + key)
        return raw === undefined ? undefined : JSON.parse(raw)
      } catch {
        return undefined
      }
    },
    async set(key, value) {
      try {
        await b.set(scope + key, JSON.stringify(value))
        return true
      } catch {
        return false
      }
    },
    async del(key) {
      try {
        await b.del(scope + key)
      } catch {
        // Deleting something we cannot reach is a no-op.
      }
    },
    async keys() {
      try {
        return (await b.keys(scope)).map((k) => k.slice(scope.length))
      } catch {
        return []
      }
    },
    async clear() {
      for (const k of await this.keys()) await this.del(k)
    },
  }
}
