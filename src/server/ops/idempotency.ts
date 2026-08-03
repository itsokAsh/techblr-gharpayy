/** Idempotency store — replay same response for the same key within TTL. */

type Entry = { status: number; body: unknown; expiresAt: number };

const store = new Map<string, Entry>();

const DEFAULT_TTL_MS = 24 * 3600_000;

export function getIdempotent(key: string): Entry | null {
  const row = store.get(key);
  if (!row) return null;
  if (Date.now() > row.expiresAt) {
    store.delete(key);
    return null;
  }
  return row;
}

export function setIdempotent(key: string, status: number, body: unknown, ttlMs = DEFAULT_TTL_MS): void {
  store.set(key, { status, body, expiresAt: Date.now() + ttlMs });
}
