import type { Property } from "@/lib/types";
import type { OpsAuth } from "./types";
import { bumpCacheVersion, getOpsSnapshot, updateOpsProperty } from "./store";

export function propertyVersion(p: Property): number {
  return p.version ?? 1;
}

export type VacancySnapshot = {
  propertyId: string;
  name: string;
  area: string;
  vacantBeds: number;
  totalBeds: number;
  version: number;
  nextVacancyAt: string | null;
  serverNow: number;
};

export type VacancyUpdateResult =
  | {
      status: "updated";
      propertyId: string;
      vacantBeds: number;
      version: number;
      nextVacancyAt: string | null;
      cacheVersion: number;
      serverNow: number;
    }
  | {
      status: "error";
      code: "not_found" | "forbidden" | "version_conflict" | "invalid";
      message: string;
      vacantBeds?: number;
      version?: number;
    };

function canWriteVacancy(auth: OpsAuth): boolean {
  return auth.role === "tcm" || auth.role === "flow-ops" || auth.role === "owner" || auth.role === "admin";
}

export function getOpsVacancy(propertyId: string): VacancySnapshot | null {
  const prop = getOpsSnapshot().properties.find((p) => p.id === propertyId);
  if (!prop) return null;
  return {
    propertyId: prop.id,
    name: prop.name,
    area: prop.area,
    vacantBeds: prop.vacantBeds,
    totalBeds: prop.totalBeds,
    version: propertyVersion(prop),
    nextVacancyAt: prop.nextVacancyAt ?? null,
    serverNow: Date.now(),
  };
}

/**
 * Optimistic vacancy write — caller must send the version it last read.
 * Mismatch → 409 version_conflict (someone else changed beds).
 */
export function updateOpsVacancy(
  auth: OpsAuth,
  propertyId: string,
  body: { expectedVersion: number; vacantBeds: number; nextVacancyAt?: string | null },
): { httpStatus: number; result: VacancyUpdateResult } {
  const serverNow = Date.now();
  if (!canWriteVacancy(auth)) {
    return { httpStatus: 403, result: { status: "error", code: "forbidden", message: "Role cannot update vacancy" } };
  }
  if (!Number.isFinite(body.expectedVersion) || body.expectedVersion < 1) {
    return { httpStatus: 400, result: { status: "error", code: "invalid", message: "expectedVersion required" } };
  }
  if (!Number.isFinite(body.vacantBeds) || body.vacantBeds < 0) {
    return { httpStatus: 400, result: { status: "error", code: "invalid", message: "vacantBeds must be >= 0" } };
  }

  const prop = getOpsSnapshot().properties.find((p) => p.id === propertyId);
  if (!prop) {
    return { httpStatus: 404, result: { status: "error", code: "not_found", message: "Property not found" } };
  }

  const current = propertyVersion(prop);
  if (body.expectedVersion !== current) {
    return {
      httpStatus: 409,
      result: {
        status: "error",
        code: "version_conflict",
        message: `Beds changed (v${current}). Refresh and rematch if needed.`,
        vacantBeds: prop.vacantBeds,
        version: current,
      },
    };
  }

  const vacantBeds = Math.min(prop.totalBeds, Math.max(0, Math.floor(body.vacantBeds)));
  const nextVersion = current + 1;
  const nextVacancyAt =
    body.nextVacancyAt !== undefined ? body.nextVacancyAt : (prop.nextVacancyAt ?? null);

  updateOpsProperty(propertyId, {
    vacantBeds,
    version: nextVersion,
    nextVacancyAt,
  });

  const cacheVersion = bumpCacheVersion();
  console.info("[ops:vacancy]", { propertyId, vacantBeds, version: nextVersion, by: auth.role });

  return {
    httpStatus: 200,
    result: {
      status: "updated",
      propertyId,
      vacantBeds,
      version: nextVersion,
      nextVacancyAt,
      cacheVersion,
      serverNow,
    },
  };
}

/** Apply optimistic lock + bump version. Returns conflict payload or new version. */
export function assertAndBumpVacancyVersion(
  propertyId: string,
  expectedVersion: number,
  patch?: Partial<Pick<Property, "vacantBeds" | "nextVacancyAt">>,
):
  | { ok: true; version: number; vacantBeds: number; property: Property }
  | { ok: false; httpStatus: 409; code: "version_conflict"; message: string; vacantBeds: number; version: number }
  | { ok: false; httpStatus: 404; code: "not_found"; message: string } {
  const prop = getOpsSnapshot().properties.find((p) => p.id === propertyId);
  if (!prop) {
    return { ok: false, httpStatus: 404, code: "not_found", message: "Property not found" };
  }
  const current = propertyVersion(prop);
  if (expectedVersion !== current) {
    return {
      ok: false,
      httpStatus: 409,
      code: "version_conflict",
      message: `Beds changed (v${current}). Refresh and rematch if needed.`,
      vacantBeds: prop.vacantBeds,
      version: current,
    };
  }
  const vacantBeds =
    patch?.vacantBeds != null ? Math.min(prop.totalBeds, Math.max(0, patch.vacantBeds)) : prop.vacantBeds;
  const nextVersion = current + 1;
  updateOpsProperty(propertyId, {
    vacantBeds,
    version: nextVersion,
    ...(patch?.nextVacancyAt !== undefined ? { nextVacancyAt: patch.nextVacancyAt } : {}),
  });
  const updated = getOpsSnapshot().properties.find((p) => p.id === propertyId)!;
  return { ok: true, version: nextVersion, vacantBeds, property: updated };
}
