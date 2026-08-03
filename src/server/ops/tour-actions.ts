import type { FollowUp, NoShowReason, PreTourCheck, PreTourProblemKind } from "@/lib/types";
import { PRE_TOUR_PROBLEM_LABELS } from "@/lib/types";
import { SLA, preTourTiming, vacancyOutlook } from "@/lib/engine";
import type { OpsAuth } from "./types";
import {
  addOpsFollowUps,
  bumpCacheVersion,
  findOpsTour,
  getOpsSnapshot,
  uid,
  updateOpsLead,
  updateOpsTour,
} from "./store";
import { assertAndBumpVacancyVersion, propertyVersion } from "./vacancy";
import { enqueueJob, processQueue } from "./worker";

export interface PreCheckBody {
  outcome: "ok" | "problem";
  problemKind?: PreTourProblemKind | null;
  note?: string | null;
  bedsReported?: number | null;
  nextBedAt?: string | null;
  /** Optimistic lock — required when confirming OK or writing beds. */
  expectedVersion?: number;
}

export type PreCheckResult =
  | {
      status: "saved";
      tourId: string;
      outcome: "ok" | "problem";
      timingPhase: string;
      timingCountdown: string;
      isRequired: boolean;
      outlookSummary: string;
      vacantBeds: number;
      propertyVersion: number;
      cacheVersion: number;
      serverNow: number;
    }
  | {
      status: "error";
      code:
        | "not_found"
        | "forbidden"
        | "bad_status"
        | "unavailable"
        | "invalid"
        | "version_conflict"
        | "no_beds";
      message: string;
      timingPhase?: string;
      timingCountdown?: string;
      vacantBeds?: number;
      propertyVersion?: number;
    };

export type NoShowResult =
  | {
      status: "logged";
      tourId: string;
      reason: NoShowReason;
      rescueCallDueAt: string;
      rescheduleDueAt: string;
      cacheVersion: number;
      serverNow: number;
      /** Jobs queued for Phase 5 worker */
      jobsQueued: Array<{ kind: string; runAt: string }>;
    }
  | {
      status: "error";
      code: "not_found" | "forbidden" | "bad_status" | "invalid";
      message: string;
    };

function canEditTour(auth: OpsAuth, tcmId: string, assignedTcmId: string): boolean {
  if (auth.role === "flow-ops" || auth.role === "admin") return true;
  if (auth.role === "tcm") return auth.tcmId === tcmId || auth.tcmId === assignedTcmId;
  return false;
}

export function saveOpsPreTourCheck(
  auth: OpsAuth,
  tourId: string,
  body: PreCheckBody,
): { httpStatus: number; result: PreCheckResult } {
  const serverNow = Date.now();
  const tour = findOpsTour(tourId);
  if (!tour) {
    return { httpStatus: 404, result: { status: "error", code: "not_found", message: "Tour not found" } };
  }
  if (tour.status !== "scheduled") {
    return { httpStatus: 409, result: { status: "error", code: "bad_status", message: `Tour is ${tour.status}` } };
  }

  const snap = getOpsSnapshot();
  const lead = snap.leads.find((l) => l.id === tour.leadId);
  if (!lead || !canEditTour(auth, tour.tcmId, lead.assignedTcmId)) {
    return { httpStatus: 403, result: { status: "error", code: "forbidden", message: "Cannot edit this tour" } };
  }

  if (body.outcome !== "ok" && body.outcome !== "problem") {
    return { httpStatus: 400, result: { status: "error", code: "invalid", message: "outcome must be ok|problem" } };
  }

  const prop = snap.properties.find((p) => p.id === tour.propertyId);
  const timing = preTourTiming(tour, serverNow);
  const actor = auth.role === "tcm" ? auth.tcmId : auth.role;
  const nowIso = new Date(serverNow).toISOString();

  const check: PreTourCheck = {
    outcome: body.outcome,
    problemKind: body.outcome === "problem" ? (body.problemKind ?? "other") : null,
    note: body.note?.trim() || null,
    bedsReported: body.bedsReported ?? null,
    nextBedAt: body.nextBedAt || null,
    at: nowIso,
    by: actor,
  };

  const needsLock = body.outcome === "ok" || body.bedsReported != null;
  if (needsLock) {
    if (body.expectedVersion == null || !Number.isFinite(body.expectedVersion)) {
      return {
        httpStatus: 400,
        result: {
          status: "error",
          code: "invalid",
          message: "expectedVersion required for vacancy lock",
          vacantBeds: prop?.vacantBeds,
          propertyVersion: prop ? propertyVersion(prop) : undefined,
        },
      };
    }
  }

  if (body.outcome === "ok") {
    const beds = body.bedsReported ?? prop?.vacantBeds ?? 0;
    check.bedsReported = beds;
    const preview = { ...check };
    if (!vacancyOutlook(prop, tour.scheduledAt, serverNow, preview).availableForTour) {
      return {
        httpStatus: 409,
        result: {
          status: "error",
          code: "no_beds",
          message: "Cannot confirm OK — bed not available for this tour slot. Rematch PG.",
          timingPhase: timing.phase,
          timingCountdown: timing.countdown,
          vacantBeds: prop?.vacantBeds,
          propertyVersion: prop ? propertyVersion(prop) : undefined,
        },
      };
    }
  }

  let propertyVersionOut = prop ? propertyVersion(prop) : 1;
  let vacantBedsOut = prop?.vacantBeds ?? 0;

  if (needsLock && prop) {
    const lock = assertAndBumpVacancyVersion(tour.propertyId, body.expectedVersion!, {
      vacantBeds: body.bedsReported != null ? Math.max(0, body.bedsReported) : undefined,
      nextVacancyAt: body.nextBedAt ?? undefined,
    });
    if (!lock.ok) {
      return {
        httpStatus: lock.httpStatus,
        result: {
          status: "error",
          code: lock.code,
          message: lock.message,
          timingPhase: timing.phase,
          timingCountdown: timing.countdown,
          vacantBeds: "vacantBeds" in lock ? lock.vacantBeds : undefined,
          propertyVersion: "version" in lock ? lock.version : undefined,
        },
      };
    }
    propertyVersionOut = lock.version;
    vacantBedsOut = lock.vacantBeds;
  }

  updateOpsTour(tourId, {
    preTourCheck: check,
    vacancyConfirmedAt: body.outcome === "ok" ? nowIso : null,
    updatedAt: nowIso,
  });

  const outlook = vacancyOutlook(
    getOpsSnapshot().properties.find((p) => p.id === tour.propertyId) ?? prop,
    tour.scheduledAt,
    serverNow,
    check,
  );
  const cacheVersion = bumpCacheVersion();

  console.info("[ops:pre-check]", {
    tourId,
    outcome: body.outcome,
    problemKind: check.problemKind,
    timingPhase: timing.phase,
    isRequired: timing.isRequired,
    propertyVersion: propertyVersionOut,
  });

  return {
    httpStatus: 200,
    result: {
      status: "saved",
      tourId,
      outcome: body.outcome,
      timingPhase: timing.phase,
      timingCountdown: timing.countdown,
      isRequired: timing.isRequired,
      outlookSummary: outlook.summary + (check.problemKind ? ` · ${PRE_TOUR_PROBLEM_LABELS[check.problemKind]}` : ""),
      vacantBeds: vacantBedsOut,
      propertyVersion: propertyVersionOut,
      cacheVersion,
      serverNow,
    },
  };
}

export function markOpsTourNoShow(
  auth: OpsAuth,
  tourId: string,
  reason: NoShowReason,
): { httpStatus: number; result: NoShowResult } {
  const serverNow = Date.now();
  const tour = findOpsTour(tourId);
  if (!tour) {
    return { httpStatus: 404, result: { status: "error", code: "not_found", message: "Tour not found" } };
  }
  if (tour.status !== "scheduled") {
    return { httpStatus: 409, result: { status: "error", code: "bad_status", message: `Tour is ${tour.status}` } };
  }

  const snap = getOpsSnapshot();
  const lead = snap.leads.find((l) => l.id === tour.leadId);
  if (!lead || !canEditTour(auth, tour.tcmId, lead.assignedTcmId)) {
    return { httpStatus: 403, result: { status: "error", code: "forbidden", message: "Cannot edit this tour" } };
  }

  const valid: NoShowReason[] = ["didnt-answer", "cancelled-last-min", "wrong-location", "other"];
  if (!valid.includes(reason)) {
    return { httpStatus: 400, result: { status: "error", code: "invalid", message: "Invalid no-show reason" } };
  }

  const nowIso = new Date(serverNow).toISOString();
  const callDue = new Date(serverNow + SLA.noShowCallMins * 60_000).toISOString();
  const slotDue = new Date(serverNow + SLA.noShowRescheduleHours * 3600_000).toISOString();

  updateOpsTour(tourId, {
    status: "no-show",
    noShowAt: nowIso,
    noShowReason: reason,
    updatedAt: nowIso,
  });

  updateOpsLead(tour.leadId, {
    stage: lead.stage === "tour-scheduled" ? "contacted" : lead.stage,
    tags: lead.tags.includes("no-show") ? lead.tags : [...lead.tags, "no-show"],
    nextFollowUpAt: callDue,
    updatedAt: nowIso,
  });

  const rescueFu: FollowUp = {
    id: uid("f"),
    tourId,
    leadId: tour.leadId,
    tcmId: tour.tcmId,
    dueAt: callDue,
    priority: "high",
    reason: "No-show rescue · call now",
    done: false,
  };
  const slotFu: FollowUp = {
    id: uid("f"),
    tourId,
    leadId: tour.leadId,
    tcmId: tour.tcmId,
    dueAt: slotDue,
    priority: "medium",
    reason: "No-show · offer new slot",
    done: false,
  };
  addOpsFollowUps([slotFu, rescueFu]);

  const job1 = enqueueJob({
    kind: "no-show-call",
    tourId,
    leadId: tour.leadId,
    tcmId: tour.tcmId,
    runAt: callDue,
  });
  const job2 = enqueueJob({
    kind: "no-show-reschedule",
    tourId,
    leadId: tour.leadId,
    tcmId: tour.tcmId,
    runAt: slotDue,
  });

  // Process any due jobs immediately
  void processQueue(serverNow);

  const cacheVersion = bumpCacheVersion();
  const jobsQueued = [
    { kind: job1.kind, jobId: job1.id, runAt: callDue, status: job1.status },
    { kind: job2.kind, jobId: job2.id, runAt: slotDue, status: job2.status },
  ];

  console.info("[ops:no-show]", { tourId, reason, jobsQueued });

  return {
    httpStatus: 200,
    result: {
      status: "logged",
      tourId,
      reason,
      rescueCallDueAt: callDue,
      rescheduleDueAt: slotDue,
      cacheVersion,
      serverNow,
      jobsQueued,
    },
  };
}
