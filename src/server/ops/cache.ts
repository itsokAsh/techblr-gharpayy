/** KV-shaped cache — in-memory for dev; swap to Cloudflare KV in production. */

export interface OpsCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

type Entry = { value: string; expiresAt: number };

class MemoryOpsCache implements OpsCache {
  private store = new Map<string, Entry>();

  async get(key: string): Promise<string | null> {
    const row = this.store.get(key);
    if (!row) return null;
    if (Date.now() > row.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return row.value;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }
}

let memoryCache: MemoryOpsCache | null = null;

export function getOpsCache(): OpsCache {
  memoryCache ??= new MemoryOpsCache();
  return memoryCache;
}

export const OPS_CACHE_TTL_SECONDS = 20;

export function queueCacheKey(filterTcmId: string | undefined, cacheVersion: number): string {
  const scope = filterTcmId ?? "all";
  return `queue:tcm:${scope}:v${cacheVersion}`;
}
