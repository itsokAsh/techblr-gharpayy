// Zustand store for the Lead Identity, Dedup & Ownership system.
// Mock layer — replaced by Lovable Cloud in the next pass.
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  UnifiedLead, AccessRequest, ActivityEntry, ParsedLeadDraft,
  MatchResult, ActivityKind, LifecycleState,
  LeadPriority, CustomTag, AssignmentEntry,
} from "./types";
import { newUlid, normalizePhoneIN, normalizeEmail, parseBudgetToNumber } from "./normalize";
import { findMatches } from "./similarity";
import { useAuditLog } from "@/lib/audit-log";

/** Mirror a lead-store mutation into the universal audit log. */
function audit(action: string, ulid: string, summary: string, actor: { id: string; name: string }, before?: unknown, after?: unknown) {
  useAuditLog.getState().log({
    actorId: actor.id, actorName: actor.name,
    entityType: "lead", entityId: ulid,
    action, summary, before, after,
  });
}

interface CurrentUser {
  id: string;
  name: string;
  role: "agent" | "manager";
}

interface IdentityStore {
  leads: UnifiedLead[];
  activities: ActivityEntry[];
  requests: AccessRequest[];
  customTags: CustomTag[];
  currentUser: CurrentUser;
  setCurrentUser: (u: CurrentUser) => void;

  /** Run dedup against current store using a parsed draft. */
  checkDuplicates: (draft: Partial<ParsedLeadDraft>) => MatchResult;

  /** Create a new unified lead from a parsed draft. Caller has already resolved dedup. */
  createLead: (
    draft: ParsedLeadDraft,
    opts?: {
      ownerId?: string;
      ownerName?: string;
      quality?: import("./types").LeadQuality;
      priority?: LeadPriority;
      tags?: string[];
      earliestCheckIn?: string;
      stage?: string;
      assigneeId?: string | null;
      assigneeName?: string | null;
      zoneCategory?: string;
    },
  ) => UnifiedLead;

  /** Append an activity to a lead's timeline. */
  logActivity: (ulid: string, kind: ActivityKind, text: string, meta?: Record<string, unknown>) => void;

  requestAccess: (ulid: string, message?: string) => AccessRequest | null;
  decideRequest: (id: string, decision: "approved" | "rejected") => void;

  setSecondaryOwner: (ulid: string, ownerId: string, ownerName: string) => void;
  reassignPrimary: (ulid: string, ownerId: string, ownerName: string, reason: string) => void;
  setLifecycleState: (ulid: string, state: LifecycleState) => void;

  // New actions
  addTag: (ulid: string, tag: string) => void;
  removeTag: (ulid: string, tag: string) => void;
  setPriority: (ulid: string, priority: LeadPriority) => void;
  setEarliestCheckIn: (ulid: string, date: string) => void;
  assignLead: (ulid: string, toMemberId: string, toMemberName: string, reason?: string) => void;
  createCustomTag: (label: string, color: string) => CustomTag;
  deleteCustomTag: (id: string) => void;

  // ── Date-anchored execution engine ──
  bookTour: (ulid: string, tourDateIso: string, propertyName?: string) => void;
  rescheduleTour: (ulid: string, newTourDateIso: string) => void;
  markNoShow: (ulid: string) => void;
  markToured: (ulid: string, interest?: import("./types").InterestLevel) => void;
  setInterestLevel: (ulid: string, level: import("./types").InterestLevel) => void;
  setObjection: (ulid: string, tag: import("./types").ObjectionTagStr) => void;
  setCheckInDate: (ulid: string, iso: string) => void;
  recordContact: (ulid: string, channel: "wa" | "call" | "email" | "visit") => void;
  recordReply: (ulid: string) => void;
  markClosed: (ulid: string, reason?: string) => void;
  /** Throws if no objection tag set — Escalation Matrix rule. */
  markLost: (ulid: string, reason: string) => void;

  getLead: (ulid: string) => UnifiedLead | undefined;
  getActivities: (ulid: string) => ActivityEntry[];
  getRequestsForOwner: (ownerId: string) => AccessRequest[];
  getRequestsByMe: (userId: string) => AccessRequest[];

  /** Link CRM row after identity ↔ CRM bridge sync. */
  linkCrmLead: (ulid: string, crmLeadId: string) => void;
}

const nowIso = () => new Date().toISOString();

export const useIdentityStore = create<IdentityStore>()(
  persist(
    (set, get) => ({
      leads: [],
      activities: [],
      requests: [],
      customTags: [],
      currentUser: { id: "u-self", name: "You", role: "agent" },

      setCurrentUser: (u) => set({ currentUser: u }),

      checkDuplicates: (draft) => {
        const phoneE164 = normalizePhoneIN(draft.phone ?? "");
        const emailNorm = normalizeEmail(draft.email ?? "");
        return findMatches(
          { phoneE164, emailNorm, name: draft.name, area: draft.location },
          get().leads,
        );
      },

      createLead: (draft, opts) => {
        const user = get().currentUser;
        const ownerId = opts?.ownerId ?? user.id;
        const ownerName = opts?.ownerName ?? user.name;
        const ts = nowIso();
        const lead: UnifiedLead = {
          ulid: newUlid(),
          name: draft.name || "Unnamed Lead",
          phoneRaw: draft.phone,
          phoneE164: normalizePhoneIN(draft.phone),
          email: draft.email,
          emailNorm: normalizeEmail(draft.email),
          area: draft.location,
          areas: draft.areas,
          fullAddress: draft.fullAddress,
          zone: draft.zone,
          zoneCategory: opts?.zoneCategory,
          quality: opts?.quality ?? null,
          priority: opts?.priority ?? "normal",
          tags: opts?.tags ?? [],
          earliestCheckIn: opts?.earliestCheckIn,
          stage: opts?.stage,
          assigneeId: opts?.assigneeId ?? null,
          assigneeName: opts?.assigneeName ?? null,
          assignmentHistory: opts?.assigneeId
            ? [{
                ts, fromId: null, fromName: null,
                toId: opts.assigneeId, toName: opts.assigneeName ?? "",
                byActorId: user.id, byActorName: user.name,
                reason: "initial assignment",
              }]
            : [],
          budget: parseBudgetToNumber(draft.budget),
          moveInDate: draft.moveIn,
          type: draft.type,
          room: draft.room,
          need: draft.need,
          inBLR: draft.inBLR,
          notes: draft.specialReqs,
          state: "new",
          primaryOwnerId: ownerId,
          secondaryOwnerId: null,
          createdAt: ts,
          updatedAt: ts,
          lastActivityAt: ts,
          rawSource: draft.rawSource,
        };
        set((s) => ({ leads: [lead, ...s.leads] }));
        get().logActivity(lead.ulid, "lead-created", `Lead created by ${ownerName}`);
        audit("lead-created", lead.ulid, `Lead created · ${lead.name}`, user, undefined, lead.name);
        return lead;
      },

      logActivity: (ulid, kind, text, meta) => {
        const user = get().currentUser;
        const entry: ActivityEntry = {
          id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          ulid, ts: nowIso(),
          actorId: user.id, actorName: user.name,
          kind, text, meta,
        };
        set((s) => ({
          activities: [entry, ...s.activities],
          leads: s.leads.map((l) => l.ulid === ulid ? { ...l, lastActivityAt: entry.ts, updatedAt: entry.ts } : l),
        }));
      },

      requestAccess: (ulid, message) => {
        const lead = get().leads.find((l) => l.ulid === ulid);
        if (!lead) return null;
        const user = get().currentUser;
        if (lead.primaryOwnerId === user.id) return null;
        // Already pending?
        const existing = get().requests.find(
          (r) => r.ulid === ulid && r.requesterId === user.id && r.state === "pending",
        );
        if (existing) return existing;
        const req: AccessRequest = {
          id: `req_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          ulid,
          requesterId: user.id,
          requesterName: user.name,
          toOwnerId: lead.primaryOwnerId,
          ts: nowIso(),
          state: "pending",
          message,
        };
        set((s) => ({ requests: [req, ...s.requests] }));
        get().logActivity(ulid, "access-requested", `${user.name} requested access`);
        return req;
      },

      decideRequest: (id, decision) => {
        const req = get().requests.find((r) => r.id === id);
        if (!req) return;
        const ts = nowIso();
        set((s) => ({
          requests: s.requests.map((r) => r.id === id ? { ...r, state: decision, decidedAt: ts } : r),
        }));
        if (decision === "approved") {
          get().setSecondaryOwner(req.ulid, req.requesterId, req.requesterName);
          get().logActivity(req.ulid, "access-granted", `Access granted to ${req.requesterName}`);
        } else {
          get().logActivity(req.ulid, "access-rejected", `Access rejected for ${req.requesterName}`);
        }
      },

      setSecondaryOwner: (ulid, ownerId, ownerName) => {
        set((s) => ({
          leads: s.leads.map((l) => l.ulid === ulid
            ? { ...l, secondaryOwnerId: ownerId, updatedAt: nowIso() }
            : l),
        }));
        get().logActivity(ulid, "secondary-added", `${ownerName} added as secondary owner`);
      },

      reassignPrimary: (ulid, ownerId, ownerName, reason) => {
        set((s) => ({
          leads: s.leads.map((l) => l.ulid === ulid
            ? { ...l, primaryOwnerId: ownerId, updatedAt: nowIso() }
            : l),
        }));
        get().logActivity(ulid, "owner-changed", `Primary owner → ${ownerName} (${reason})`);
      },

      setLifecycleState: (ulid, state) => {
        const lead = get().leads.find((l) => l.ulid === ulid);
        const before = lead?.state;
        set((s) => ({
          leads: s.leads.map((l) => l.ulid === ulid ? { ...l, state, updatedAt: nowIso() } : l),
        }));
        get().logActivity(ulid, "state-changed", `State → ${state}`);
        audit("state-changed", ulid, `State: ${before ?? "—"} → ${state}`, get().currentUser, before, state);
      },

      addTag: (ulid, tag) => {
        const t = tag.trim();
        if (!t) return;
        set((s) => ({
          leads: s.leads.map((l) => l.ulid === ulid && !(l.tags ?? []).includes(t)
            ? { ...l, tags: [...(l.tags ?? []), t], updatedAt: nowIso() }
            : l),
        }));
        get().logActivity(ulid, "tag-added", `Tag added: ${t}`, { tag: t });
        audit("tag-added", ulid, `Tag added: ${t}`, get().currentUser, undefined, t);
      },

      removeTag: (ulid, tag) => {
        set((s) => ({
          leads: s.leads.map((l) => l.ulid === ulid
            ? { ...l, tags: (l.tags ?? []).filter((x) => x !== tag), updatedAt: nowIso() }
            : l),
        }));
        get().logActivity(ulid, "tag-removed", `Tag removed: ${tag}`, { tag });
        audit("tag-removed", ulid, `Tag removed: ${tag}`, get().currentUser, tag, undefined);
      },

      setPriority: (ulid, priority) => {
        const lead = get().leads.find((l) => l.ulid === ulid);
        const before = lead?.priority ?? "normal";
        set((s) => ({
          leads: s.leads.map((l) => l.ulid === ulid
            ? { ...l, priority, updatedAt: nowIso() }
            : l),
        }));
        get().logActivity(ulid, "priority-changed",
          `Priority: ${before} → ${priority ?? "normal"}`,
          { before, after: priority });
        audit("priority-changed", ulid, `Priority: ${before} → ${priority ?? "normal"}`, get().currentUser, before, priority);
      },

      setEarliestCheckIn: (ulid, date) => {
        const lead = get().leads.find((l) => l.ulid === ulid);
        const before = lead?.earliestCheckIn;
        set((s) => ({
          leads: s.leads.map((l) => l.ulid === ulid
            ? { ...l, earliestCheckIn: date, updatedAt: nowIso() }
            : l),
        }));
        get().logActivity(ulid, "earliest-checkin-set",
          `Earliest check-in: ${date}`, { date });
        audit("earliest-checkin-set", ulid, `Earliest check-in: ${before ?? "—"} → ${date}`, get().currentUser, before, date);
      },

      assignLead: (ulid, toMemberId, toMemberName, reason) => {
        const user = get().currentUser;
        const lead = get().leads.find((l) => l.ulid === ulid);
        if (!lead) return;
        const entry: AssignmentEntry = {
          ts: nowIso(),
          fromId: lead.assigneeId ?? null,
          fromName: lead.assigneeName ?? null,
          toId: toMemberId,
          toName: toMemberName,
          byActorId: user.id,
          byActorName: user.name,
          reason,
        };
        set((s) => ({
          leads: s.leads.map((l) => l.ulid === ulid
            ? {
                ...l,
                assigneeId: toMemberId,
                assigneeName: toMemberName,
                assignmentHistory: [entry, ...(l.assignmentHistory ?? [])],
                updatedAt: nowIso(),
              }
            : l),
        }));
        get().logActivity(ulid, "assignee-changed",
          `Assigned to ${toMemberName}${reason ? ` (${reason})` : ""}`,
          { toId: toMemberId, fromId: entry.fromId });
        audit("assignee-changed", ulid,
          `Assigned: ${entry.fromName ?? "—"} → ${toMemberName}${reason ? ` (${reason})` : ""}`,
          user, entry.fromName, toMemberName);
      },

      createCustomTag: (label, color) => {
        const user = get().currentUser;
        const tag: CustomTag = {
          id: `tag_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          label: label.trim(),
          color,
          createdBy: user.id,
          ts: nowIso(),
        };
        set((s) => ({ customTags: [tag, ...s.customTags] }));
        return tag;
      },

      deleteCustomTag: (id) => {
        set((s) => ({ customTags: s.customTags.filter((t) => t.id !== id) }));
      },

      bookTour: (ulid, tourDateIso, propertyName) => {
        set((s) => ({
          leads: s.leads.map((l) => l.ulid === ulid ? {
            ...l,
            phase: 2,
            stageTag: "TOUR_SCHEDULED",
            state: "visit-scheduled",
            anchors: { ...(l.anchors ?? { leadDate: l.createdAt }), tourDate: tourDateIso },
            propertyName: propertyName ?? l.propertyName,
            noShowFlag: false,
            updatedAt: nowIso(),
          } : l),
        }));
        get().logActivity(ulid, "visit-scheduled", `Tour booked for ${new Date(tourDateIso).toLocaleString()}`);
        audit("tour-booked", ulid, `Tour booked → ${tourDateIso}`, get().currentUser, undefined, tourDateIso);
      },

      rescheduleTour: (ulid, newTourDateIso) => {
        const lead = get().leads.find((l) => l.ulid === ulid);
        const before = lead?.anchors?.tourDate;
        set((s) => ({
          leads: s.leads.map((l) => l.ulid === ulid ? {
            ...l,
            anchors: { ...(l.anchors ?? { leadDate: l.createdAt }), tourDate: newTourDateIso },
            noShowFlag: false,
            updatedAt: nowIso(),
          } : l),
        }));
        get().logActivity(ulid, "visit-scheduled", `Tour rescheduled → ${new Date(newTourDateIso).toLocaleString()}`);
        audit("tour-rescheduled", ulid, `Tour: ${before ?? "—"} → ${newTourDateIso}`, get().currentUser, before, newTourDateIso);
      },

      markNoShow: (ulid) => {
        set((s) => ({
          leads: s.leads.map((l) => l.ulid === ulid ? {
            ...l, noShowFlag: true, noShowCount: (l.noShowCount ?? 0) + 1, updatedAt: nowIso(),
          } : l),
        }));
        get().logActivity(ulid, "note-added", "Marked no-show");
        audit("no-show", ulid, "Marked no-show", get().currentUser);
      },

      markToured: (ulid, interest) => {
        set((s) => ({
          leads: s.leads.map((l) => l.ulid === ulid ? {
            ...l,
            phase: 3,
            stageTag: "TOURED",
            state: "visit-done",
            interestLevel: interest ?? l.interestLevel ?? null,
            noShowFlag: false,
            updatedAt: nowIso(),
          } : l),
        }));
        get().logActivity(ulid, "visit-done", `Tour completed${interest ? ` · ${interest}` : ""}`);
        audit("toured", ulid, `Toured · ${interest ?? "—"}`, get().currentUser);
      },

      setInterestLevel: (ulid, level) => {
        set((s) => ({
          leads: s.leads.map((l) => l.ulid === ulid ? { ...l, interestLevel: level, updatedAt: nowIso() } : l),
        }));
        get().logActivity(ulid, "note-added", `Interest: ${level ?? "—"}`);
      },

      setObjection: (ulid, tag) => {
        const lead = get().leads.find((l) => l.ulid === ulid);
        const before = lead?.primaryObjection ?? null;
        set((s) => ({
          leads: s.leads.map((l) => l.ulid === ulid ? { ...l, primaryObjection: tag, updatedAt: nowIso() } : l),
        }));
        get().logActivity(ulid, "note-added", `Objection: ${tag}`);
        audit("objection-set", ulid, `Objection: ${before ?? "—"} → ${tag}`, get().currentUser, before, tag);
      },

      setCheckInDate: (ulid, iso) => {
        set((s) => ({
          leads: s.leads.map((l) => l.ulid === ulid ? {
            ...l,
            anchors: { ...(l.anchors ?? { leadDate: l.createdAt }), checkInDate: iso },
            updatedAt: nowIso(),
          } : l),
        }));
        get().logActivity(ulid, "note-added", `Check-in date set: ${iso}`);
      },

      recordContact: (ulid, channel) => {
        set((s) => ({
          leads: s.leads.map((l) => l.ulid === ulid ? {
            ...l,
            lastContactAt: nowIso(),
            followUpCount: (l.followUpCount ?? 0) + 1,
            stageTag: l.stageTag === "NEW" ? "CONTACTED" : l.stageTag,
            updatedAt: nowIso(),
          } : l),
        }));
        const kindMap = { wa: "whatsapp-sent", call: "call-logged", email: "note-added", visit: "visit-done" } as const;
        get().logActivity(ulid, kindMap[channel] as ActivityKind, `Contact via ${channel}`);
      },

      recordReply: (ulid) => {
        set((s) => ({
          leads: s.leads.map((l) => l.ulid === ulid ? { ...l, replied: true, updatedAt: nowIso() } : l),
        }));
        get().logActivity(ulid, "note-added", "Lead replied");
      },

      markClosed: (ulid, reason) => {
        set((s) => ({
          leads: s.leads.map((l) => l.ulid === ulid ? {
            ...l, phase: 4, stageTag: "CLOSED", state: "converted",
            closedReason: reason, updatedAt: nowIso(),
          } : l),
        }));
        get().logActivity(ulid, "state-changed", `CLOSED${reason ? ` · ${reason}` : ""}`);
        audit("closed", ulid, `Lead closed${reason ? ` · ${reason}` : ""}`, get().currentUser);
      },

      markLost: (ulid, reason) => {
        const lead = get().leads.find((l) => l.ulid === ulid);
        if (!lead?.primaryObjection) {
          throw new Error("Cannot mark LOST without a primary objection tag.");
        }
        set((s) => ({
          leads: s.leads.map((l) => l.ulid === ulid ? {
            ...l, phase: 4, stageTag: "LOST", state: "dropped",
            lostReason: reason, updatedAt: nowIso(),
          } : l),
        }));
        get().logActivity(ulid, "state-changed", `LOST · ${reason}`);
        audit("lost", ulid, `Lead lost · ${reason}`, get().currentUser);
      },


      getLead: (ulid) => get().leads.find((l) => l.ulid === ulid),
      getActivities: (ulid) => get().activities.filter((a) => a.ulid === ulid),
      getRequestsForOwner: (ownerId) =>
        get().requests.filter((r) => r.toOwnerId === ownerId && r.state === "pending"),
      getRequestsByMe: (userId) => get().requests.filter((r) => r.requesterId === userId),

      linkCrmLead: (ulid, crmLeadId) => {
        const existing = get().leads.find((l) => l.ulid === ulid);
        if (existing?.crmLeadId === crmLeadId) return;
        set((s) => ({
          leads: s.leads.map((l) =>
            l.ulid === ulid ? { ...l, crmLeadId, updatedAt: nowIso() } : l,
          ),
        }));
      },
    }),
    {
      name: "lead-identity-store-v1",
      onRehydrateStorage: () => (_state, err) => {
        if (err) return;
        // Hydrate CRM outside React — avoids effect/persist feedback loops.
        queueMicrotask(() => {
          void import("./bridge").then(({ hydrateCrmFromIdentity }) => {
            hydrateCrmFromIdentity();
          });
        });
      },
    },
  ),
);
