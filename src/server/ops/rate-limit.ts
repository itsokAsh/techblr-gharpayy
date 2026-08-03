/** Sliding-window rate limit (in-memory; swap to KV in prod). */

type Bucket = { timestamps: number[] };

const buckets = new Map<string, Bucket>();

export function checkRateLimit(opts: {
  key: string;
  limit: number;
  windowMs: number;
}): { ok: true } | { ok: false; retryAfterSec: number } {
  const now = Date.now();
  const bucket = buckets.get(opts.key) ?? { timestamps: [] };
  bucket.timestamps = bucket.timestamps.filter((t) => now - t < opts.windowMs);

  if (bucket.timestamps.length >= opts.limit) {
    const oldest = bucket.timestamps[0]!;
    const retryAfterSec = Math.ceil((opts.windowMs - (now - oldest)) / 1000);
    buckets.set(opts.key, bucket);
    return { ok: false, retryAfterSec: Math.max(1, retryAfterSec) };
  }

  bucket.timestamps.push(now);
  buckets.set(opts.key, bucket);
  return { ok: true };
}

/** Paste ingest: 20 / TCM / minute, 40 / IP / minute */
export const INGEST_TCM_LIMIT = { limit: 20, windowMs: 60_000 };
export const INGEST_IP_LIMIT = { limit: 40, windowMs: 60_000 };
