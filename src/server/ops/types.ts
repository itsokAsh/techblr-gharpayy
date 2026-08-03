import type { NextAction } from "@/lib/engine";

export type OpsRole = "tcm" | "flow-ops" | "hr" | "owner" | "admin";

export interface OpsAuth {
  role: OpsRole;
  tcmId: string;
}

export interface TodayQueueResponse {
  items: NextAction[];
  serverNow: number;
  cachedAt: number;
  cacheVersion: number;
  filterTcmId: string | null;
}

export interface OpsHealthResponse {
  ok: boolean;
  service: string;
  cacheVersion: number;
  serverNow: number;
}
