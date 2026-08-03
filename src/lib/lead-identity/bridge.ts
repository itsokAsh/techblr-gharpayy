/**
 * Lead Identity ↔ CRM bridge (Phase 0).
 * One create path: identity store + main CRM store stay in sync.
 */
import type { Intent, Lead } from "@/lib/types";
import { useApp } from "@/lib/store";
import { autoAssign, type RouteSuggestion } from "@/lib/routing";
import { useIdentityStore } from "./store";
import { normalizePhoneIN, toMoveInIso, isValidDateInput } from "./normalize";
import type {
  LeadQuality,
  LeadPriority,
  MatchResult,
  ParsedLeadDraft,
  UnifiedLead,
} from "./types";

export interface CreateLeadBridgeOpts {
  ownerId?: string;
  ownerName?: string;
  quality?: LeadQuality;
  priority?: LeadPriority;
  tags?: string[];
  earliestCheckIn?: string;
  stage?: string;
  assigneeId?: string | null;
  assigneeName?: string | null;
  zoneCategory?: string;
  source?: string;
}

export interface CreateLeadBridgeResult {
  unified: UnifiedLead;
  crm: Lead;
  assignment: RouteSuggestion;
}

function qualityToIntent(quality?: LeadQuality | null): Intent {
  if (quality === "hot") return "hot";
  if (quality === "bad") return "cold";
  return "warm";
}

function preferredAreaFrom(unified: UnifiedLead, draft: ParsedLeadDraft): string {
  return (
    unified.area?.trim() ||
    unified.areas?.[0]?.trim() ||
    draft.location?.trim() ||
    "Unknown"
  );
}

/** Minimal unified shape for CRM-only rows surfaced in dedup UI. */
export function crmLeadToUnifiedStub(crm: Lead): UnifiedLead {
  const ts = crm.createdAt;
  return {
    ulid: crm.identityUlid ?? `crm:${crm.id}`,
    crmLeadId: crm.id,
    name: crm.name,
    phoneE164: normalizePhoneIN(crm.phone),
    phoneRaw: crm.phone,
    email: "",
    emailNorm: "",
    area: crm.preferredArea,
    areas: [crm.preferredArea],
    zone: "",
    budget: crm.budget,
    moveInDate: crm.moveInDate,
    type: "",
    room: "",
    need: "",
    inBLR: null,
    notes: "",
    state: "new",
    primaryOwnerId: "system",
    secondaryOwnerId: null,
    createdAt: ts,
    updatedAt: crm.updatedAt,
    lastActivityAt: crm.updatedAt,
  };
}

/** Dedup across identity store + CRM mock/user leads. */
export function checkDuplicatesBridged(draft: Partial<ParsedLeadDraft>): MatchResult {
  const identity = useIdentityStore.getState();
  const crmLeads = useApp.getState().leads;
  const phoneE164 = normalizePhoneIN(draft.phone ?? "");
  const emailNorm = (draft.email ?? "").trim().toLowerCase();

  const identityResult = identity.checkDuplicates(draft);

  const crmHits = crmLeads.filter((l) => {
    if (phoneE164 && normalizePhoneIN(l.phone) === phoneE164) return true;
    if (emailNorm && draft.email && l.name.toLowerCase() === (draft.name ?? "").toLowerCase()) return false;
    return false;
  });

  if (crmHits.length === 0) return identityResult;

  const mergedCandidates = [...identityResult.candidates];
  for (const crm of crmHits) {
    const linked = identity.leads.find((u) => u.ulid === crm.identityUlid || u.crmLeadId === crm.id);
    const stub = linked ?? crmLeadToUnifiedStub(crm);
    const already = mergedCandidates.some((c) => c.lead.ulid === stub.ulid || c.lead.crmLeadId === crm.id);
    if (!already) {
      mergedCandidates.unshift({
        lead: stub,
        score: 98,
        reasons: ["phone exact (CRM)"],
      });
    }
  }

  mergedCandidates.sort((a, b) => b.score - a.score);
  const topScore = mergedCandidates[0]?.score ?? 0;
  const type =
    topScore >= 95 ? "exact" : topScore >= 70 ? "strong" : topScore >= 40 ? "possible" : "new";

  return {
    type,
    topScore,
    candidates: mergedCandidates.slice(0, 5),
  };
}

function previewAssignment(
  draft: ParsedLeadDraft,
  unified: UnifiedLead,
  intent: Intent,
  preferredArea: string,
): RouteSuggestion {
  const app = useApp.getState();
  const nowIso = new Date().toISOString();
  return autoAssign(
    {
      id: "tmp",
      name: unified.name,
      phone: unified.phoneRaw || unified.phoneE164,
      source: "Direct",
      budget: unified.budget,
      preferredArea,
      assignedTcmId: "",
      stage: "new",
      intent,
      confidence: intent === "hot" ? 70 : intent === "cold" ? 25 : 50,
      tags: [],
      nextFollowUpAt: null,
      responseSpeedMins: 30,
      moveInDate: toMoveInIso(draft.moveIn),
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    app.tcms,
    app.leads,
    app.tours,
  );
}

/** Create in identity + CRM and link both IDs. */
export function createLeadWithCrmSync(
  draft: ParsedLeadDraft,
  opts?: CreateLeadBridgeOpts,
): CreateLeadBridgeResult {
  const identity = useIdentityStore.getState();
  const unified = identity.createLead(draft, opts);

  const preferredArea = preferredAreaFrom(unified, draft);
  const intent = qualityToIntent(opts?.quality ?? unified.quality);
  const assignment = previewAssignment(draft, unified, intent, preferredArea);

  const crm = useApp.getState().importLeadFromIdentity({
    identityUlid: unified.ulid,
    name: unified.name,
    phone: unified.phoneRaw || unified.phoneE164,
    source: opts?.source ?? "Direct",
    budget: unified.budget,
    preferredArea,
    moveInDate: toMoveInIso(draft.moveIn),
    intent,
    assignedTcmId: assignment.tcmId,
    tags: opts?.tags,
  });

  identity.linkCrmLead(unified.ulid, crm.id);

  return {
    unified: { ...unified, crmLeadId: crm.id },
    crm,
    assignment,
  };
}

/** Push one identity lead into CRM (hydrate / repair). */
export function syncUnifiedLeadToCrm(unified: UnifiedLead): Lead {
  const intent = qualityToIntent(unified.quality);
  const preferredArea = unified.area || unified.areas?.[0] || "Unknown";
  const crm = useApp.getState().importLeadFromIdentity({
    identityUlid: unified.ulid,
    name: unified.name,
    phone: unified.phoneRaw || unified.phoneE164,
    source: "Direct",
    budget: unified.budget,
    preferredArea,
    moveInDate: toMoveInIso(unified.moveInDate),
    intent,
    assignedTcmId: undefined,
    tags: unified.tags,
  });
  useIdentityStore.getState().linkCrmLead(unified.ulid, crm.id);
  return crm;
}

let hydrateOnce = false;

/** After identity persist rehydrate, ensure CRM has matching rows. Idempotent. */
export function hydrateCrmFromIdentity(): boolean {
  if (hydrateOnce) return false;
  hydrateOnce = true;

  const identityLeads = useIdentityStore.getState().leads;
  if (identityLeads.length === 0) return false;

  let changed = false;

  for (const unified of identityLeads) {
    const crmLeads = useApp.getState().leads;
    const byUlid = crmLeads.find((l) => l.identityUlid === unified.ulid);
    const byCrmId = unified.crmLeadId
      ? crmLeads.find((l) => l.id === unified.crmLeadId)
      : undefined;

    if (!byUlid && !byCrmId) {
      syncUnifiedLeadToCrm(unified);
      changed = true;
      continue;
    }

    const linked = byUlid ?? byCrmId;
    if (linked && unified.crmLeadId !== linked.id) {
      useIdentityStore.getState().linkCrmLead(unified.ulid, linked.id);
      changed = true;
    }
    // Repair CRM rows that inherited free-text move-in ("Last week of April")
    if (linked && !isValidDateInput(linked.moveInDate)) {
      useApp.getState().importLeadFromIdentity({
        identityUlid: unified.ulid,
        name: linked.name,
        phone: linked.phone,
        source: linked.source,
        budget: linked.budget,
        preferredArea: linked.preferredArea,
        moveInDate: toMoveInIso(unified.moveInDate || linked.moveInDate),
        intent: linked.intent,
        assignedTcmId: linked.assignedTcmId,
        tags: linked.tags,
      });
      changed = true;
    }
  }

  return changed;
}

export function getCrmLeadForUnified(ulid: string): Lead | undefined {
  const unified = useIdentityStore.getState().getLead(ulid);
  const crmLeads = useApp.getState().leads;
  if (unified?.crmLeadId) {
    return crmLeads.find((l) => l.id === unified.crmLeadId);
  }
  return crmLeads.find((l) => l.identityUlid === ulid);
}

export function openCrmLeadForUnified(ulid: string): boolean {
  const crm = getCrmLeadForUnified(ulid);
  if (!crm) return false;
  useApp.getState().selectLead(crm.id);
  return true;
}
