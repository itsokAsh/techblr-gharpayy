import { buildDoNextQueue } from "@/lib/engine";
import { getOpsCache, OPS_CACHE_TTL_SECONDS, queueCacheKey } from "./cache";
import { getCacheVersion, getOpsSnapshot } from "./store";
import type { TodayQueueResponse } from "./types";

export async function getTodayQueue(filterTcmId?: string): Promise<{
  body: TodayQueueResponse;
  cache: "HIT" | "MISS";
}> {
  const cache = getOpsCache();
  const cacheVersion = getCacheVersion();
  const key = queueCacheKey(filterTcmId, cacheVersion);

  const hit = await cache.get(key);
  if (hit) {
    const parsed = JSON.parse(hit) as TodayQueueResponse;
    return { body: parsed, cache: "HIT" };
  }

  const { leads, tours, followUps, properties, tcms } = getOpsSnapshot();
  const serverNow = Date.now();
  const items = buildDoNextQueue(leads, tours, followUps, serverNow, filterTcmId, {
    uniqueByLead: true,
    properties,
    tcms,
  });

  const body: TodayQueueResponse = {
    items,
    serverNow,
    cachedAt: serverNow,
    cacheVersion,
    filterTcmId: filterTcmId ?? null,
  };

  await cache.set(key, JSON.stringify(body), OPS_CACHE_TTL_SECONDS);
  return { body, cache: "MISS" };
}
