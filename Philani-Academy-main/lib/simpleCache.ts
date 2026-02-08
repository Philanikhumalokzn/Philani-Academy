type CacheEntry<T> = {
  value: T
  expiresAt: number
}

const globalForCache = globalThis as unknown as {
  __paSimpleCache?: Map<string, CacheEntry<any>>
}

const cache = globalForCache.__paSimpleCache ?? new Map<string, CacheEntry<any>>()
if (!globalForCache.__paSimpleCache) globalForCache.__paSimpleCache = cache

export function cacheGet<T>(key: string): T | null {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    cache.delete(key)
    return null
  }
  return entry.value as T
}

export function cacheSet<T>(key: string, value: T, ttlMs: number) {
  cache.set(key, { value, expiresAt: Date.now() + Math.max(0, ttlMs) })
}

export function cacheDel(key: string) {
  cache.delete(key)
}
