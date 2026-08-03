import type { OpsHealthResponse, OpsRole, TodayQueueResponse } from "@/server/ops/types";
import type { IngestBody, IngestResult } from "@/server/ops/ingest";
import type { NoShowResult, PreCheckBody, PreCheckResult } from "@/server/ops/tour-actions";
import type { VacancySnapshot, VacancyUpdateResult } from "@/server/ops/vacancy";
import type { NoShowReason } from "@/lib/types";

function opsHeaders(role: OpsRole, tcmId: string, extra?: HeadersInit): HeadersInit {
  return {
    "x-role": role,
    "x-tcm-id": tcmId,
    Accept: "application/json",
    ...extra,
  };
}

export async function fetchOpsHealth(): Promise<OpsHealthResponse> {
  const res = await fetch("/api/ops/health");
  if (!res.ok) throw new Error(`Ops health failed: ${res.status}`);
  return res.json() as Promise<OpsHealthResponse>;
}

export async function fetchTodayQueue(opts: {
  role: OpsRole;
  tcmId: string;
  filterTcmId?: string;
}): Promise<TodayQueueResponse & { cache?: string }> {
  const params = new URLSearchParams();
  if (opts.filterTcmId) params.set("tcmId", opts.filterTcmId);
  const qs = params.toString();
  const res = await fetch(`/api/ops/today/queue${qs ? `?${qs}` : ""}`, {
    headers: opsHeaders(opts.role, opts.tcmId),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `Queue fetch failed: ${res.status}`);
  }
  const data = (await res.json()) as TodayQueueResponse;
  return { ...data, cache: res.headers.get("X-Cache") ?? undefined };
}

export async function invalidateOpsCache(role: OpsRole, tcmId: string): Promise<number> {
  const res = await fetch("/api/ops/cache/invalidate", {
    method: "POST",
    headers: opsHeaders(role, tcmId),
  });
  if (!res.ok) throw new Error(`Cache invalidate failed: ${res.status}`);
  const body = (await res.json()) as { cacheVersion: number };
  return body.cacheVersion;
}

export async function ingestLeadViaOps(opts: {
  role: OpsRole;
  tcmId: string;
  body: IngestBody;
  idempotencyKey?: string;
}): Promise<IngestResult & { httpStatus: number; replay?: boolean }> {
  const res = await fetch("/api/ops/leads/ingest", {
    method: "POST",
    headers: opsHeaders(opts.role, opts.tcmId, {
      "Content-Type": "application/json",
      ...(opts.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : {}),
    }),
    body: JSON.stringify(opts.body),
  });
  const data = (await res.json()) as IngestResult | { error?: string; retryAfterSec?: number };
  if (res.status === 429) {
    const err = data as { error?: string; retryAfterSec?: number };
    throw new Error(err.error ?? `Rate limited · retry in ${err.retryAfterSec ?? "?"}s`);
  }
  if (!("status" in data)) {
    throw new Error((data as { error?: string }).error ?? `Ingest failed: ${res.status}`);
  }
  return {
    ...data,
    httpStatus: res.status,
    replay: res.headers.get("X-Idempotent-Replay") === "true",
  };
}

function newIdemKey(prefix: string): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `${prefix}-${crypto.randomUUID()}`
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function fetchOpsVacancy(opts: {
  role: OpsRole;
  tcmId: string;
  propertyId: string;
}): Promise<VacancySnapshot> {
  const res = await fetch(`/api/ops/properties/${opts.propertyId}`, {
    headers: opsHeaders(opts.role, opts.tcmId),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `Vacancy fetch failed: ${res.status}`);
  }
  return res.json() as Promise<VacancySnapshot>;
}

export async function updateVacancyViaOps(opts: {
  role: OpsRole;
  tcmId: string;
  propertyId: string;
  expectedVersion: number;
  vacantBeds: number;
  nextVacancyAt?: string | null;
  idempotencyKey?: string;
}): Promise<VacancyUpdateResult & { httpStatus: number; replay?: boolean }> {
  const res = await fetch(`/api/ops/properties/${opts.propertyId}/vacancy`, {
    method: "POST",
    headers: opsHeaders(opts.role, opts.tcmId, {
      "Content-Type": "application/json",
      "Idempotency-Key": opts.idempotencyKey ?? newIdemKey("vac"),
    }),
    body: JSON.stringify({
      expectedVersion: opts.expectedVersion,
      vacantBeds: opts.vacantBeds,
      nextVacancyAt: opts.nextVacancyAt,
    }),
  });
  const data = (await res.json()) as VacancyUpdateResult;
  if (!("status" in data)) throw new Error(`Vacancy update failed: ${res.status}`);
  return { ...data, httpStatus: res.status, replay: res.headers.get("X-Idempotent-Replay") === "true" };
}

export async function savePreCheckViaOps(opts: {
  role: OpsRole;
  tcmId: string;
  tourId: string;
  body: PreCheckBody;
  idempotencyKey?: string;
}): Promise<PreCheckResult & { httpStatus: number; replay?: boolean }> {
  const res = await fetch(`/api/ops/tours/${opts.tourId}/pre-check`, {
    method: "POST",
    headers: opsHeaders(opts.role, opts.tcmId, {
      "Content-Type": "application/json",
      "Idempotency-Key": opts.idempotencyKey ?? newIdemKey("pre"),
    }),
    body: JSON.stringify(opts.body),
  });
  const data = (await res.json()) as PreCheckResult;
  if (!("status" in data)) throw new Error(`Pre-check failed: ${res.status}`);
  return { ...data, httpStatus: res.status, replay: res.headers.get("X-Idempotent-Replay") === "true" };
}

export async function markNoShowViaOps(opts: {
  role: OpsRole;
  tcmId: string;
  tourId: string;
  reason: NoShowReason;
  idempotencyKey?: string;
}): Promise<NoShowResult & { httpStatus: number; replay?: boolean }> {
  const res = await fetch(`/api/ops/tours/${opts.tourId}/no-show`, {
    method: "POST",
    headers: opsHeaders(opts.role, opts.tcmId, {
      "Content-Type": "application/json",
      "Idempotency-Key": opts.idempotencyKey ?? newIdemKey("noshow"),
    }),
    body: JSON.stringify({ reason: opts.reason }),
  });
  const data = (await res.json()) as NoShowResult;
  if (!("status" in data)) throw new Error(`No-show failed: ${res.status}`);
  return { ...data, httpStatus: res.status, replay: res.headers.get("X-Idempotent-Replay") === "true" };
}

export async function fetchQueueJobs(opts: { role: OpsRole; tcmId: string }) {
  const res = await fetch("/api/ops/jobs", {
    headers: opsHeaders(opts.role, opts.tcmId),
  });
  if (!res.ok) throw new Error(`Jobs fetch failed: ${res.status}`);
  return res.json() as Promise<{
    jobs: Array<{
      id: string;
      kind: string;
      tourId: string;
      leadId: string;
      tcmId: string;
      runAt: string;
      status: string;
      attempts: number;
      maxAttempts: number;
      lastError?: string;
      executedAt?: string;
    }>;
    stats: {
      total: number;
      pending: number;
      processing: number;
      completed: number;
      failed: number;
      serverNow: number;
    };
  }>;
}

export async function triggerQueueWorker(opts: { role: OpsRole; tcmId: string; action?: "tick" | "retry"; jobId?: string }) {
  const res = await fetch("/api/ops/jobs", {
    method: "POST",
    headers: opsHeaders(opts.role, opts.tcmId, { "Content-Type": "application/json" }),
    body: JSON.stringify({ action: opts.action ?? "tick", jobId: opts.jobId }),
  });
  if (!res.ok) throw new Error(`Worker trigger failed: ${res.status}`);
  return res.json();
}
