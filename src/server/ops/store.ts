import type { FollowUp, Lead, NoShowReason, PreTourCheck, PreTourProblemKind, Property, Tour } from "@/lib/types";
import { FOLLOWUPS, LEADS, PROPERTIES, TCMS, TOURS } from "@/lib/mock-data";

/** Bumped on any ops mutation — invalidates versioned queue cache keys. */
let cacheVersion = 1;

let opsLeads: Lead[] = LEADS.map((l) => ({ ...l }));
let opsTours: Tour[] = TOURS.map((t) => ({ ...t }));
let opsFollowUps: FollowUp[] = FOLLOWUPS.map((f) => ({ ...f }));
let opsProperties: Property[] = PROPERTIES.map((p) => ({ ...p, version: p.version ?? 1 }));

const phoneHashIndex = new Map<string, string>();

export function getCacheVersion(): number {
  return cacheVersion;
}

export function bumpCacheVersion(): number {
  cacheVersion += 1;
  return cacheVersion;
}

export function getOpsSnapshot() {
  return {
    leads: opsLeads,
    tours: opsTours,
    followUps: opsFollowUps,
    properties: opsProperties,
    tcms: TCMS,
  };
}

export function findLeadByPhoneHash(hash: string): Lead | undefined {
  const id = phoneHashIndex.get(hash);
  if (id) return opsLeads.find((l) => l.id === id);
  return undefined;
}

export function indexPhoneHash(hash: string, leadId: string): void {
  phoneHashIndex.set(hash, leadId);
}

export function addOpsLead(lead: Lead): void {
  opsLeads = [lead, ...opsLeads];
}

export function findOpsTour(tourId: string): Tour | undefined {
  return opsTours.find((t) => t.id === tourId);
}

export function updateOpsTour(tourId: string, patch: Partial<Tour>): Tour | undefined {
  let next: Tour | undefined;
  opsTours = opsTours.map((t) => {
    if (t.id !== tourId) return t;
    next = { ...t, ...patch };
    return next;
  });
  return next;
}

export function updateOpsLead(leadId: string, patch: Partial<Lead>): void {
  opsLeads = opsLeads.map((l) => (l.id === leadId ? { ...l, ...patch } : l));
}

export function updateOpsProperty(propertyId: string, patch: Partial<Property>): void {
  opsProperties = opsProperties.map((p) => (p.id === propertyId ? { ...p, ...patch } : p));
}

export function addOpsFollowUps(fus: FollowUp[]): void {
  opsFollowUps = [...fus, ...opsFollowUps];
}

export function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

export type { PreTourCheck, PreTourProblemKind, NoShowReason };
