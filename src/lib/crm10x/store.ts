import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  AssignmentRecord, CallRecord, CoachingNote, DeepLeadProfile,
  DuplicateMerge, LeadCommitment, ObjectionRecord, VisitIntel,
  MessageOutcome, ShiftingDateEntry,
} from "./types";

const uid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;

interface CRM10xState {
  profiles: Record<string, DeepLeadProfile>;
  objections: ObjectionRecord[];
  calls: CallRecord[];
  visits: Record<string, VisitIntel>;        // keyed by tourId
  commitments: LeadCommitment[];
  assignments: AssignmentRecord[];
  merges: DuplicateMerge[];
  coachingNotes: CoachingNote[];
  messageOutcomes: MessageOutcome[];

  upsertProfile: (p: Partial<DeepLeadProfile> & { leadId: string }) => void;
  addShiftingDate: (
    leadId: string,
    entry: Omit<ShiftingDateEntry, "ts">,
  ) => void;

  logObjection: (r: Omit<ObjectionRecord, "id" | "ts">) => ObjectionRecord;
  resolveObjection: (id: string, resolution: ObjectionRecord["resolution"]) => void;

  logCall: (r: Omit<CallRecord, "id" | "ts">) => CallRecord;

  upsertVisit: (v: Partial<VisitIntel> & { tourId: string; leadId: string }) => void;

  addCommitment: (c: Omit<LeadCommitment, "id" | "ts" | "status">) => LeadCommitment;
  resolveCommitment: (id: string, status: "kept" | "missed") => void;

  addAssignment: (a: Omit<AssignmentRecord, "id" | "ts">) => AssignmentRecord;

  mergeDuplicates: (m: Omit<DuplicateMerge, "id" | "ts">) => DuplicateMerge;

  addCoachingNote: (n: Omit<CoachingNote, "id" | "ts">) => CoachingNote;

  logMessageSend: (m: Omit<MessageOutcome, "id" | "ts" | "replied" | "bookedAfter" | "attributedBookingId">) => MessageOutcome;
  markMessageReplied: (id: string) => void;
  markMessageBookedAfter: (
    leadId: string,
    bookingId?: string,
    bookingTs?: string,
  ) => void;

  // selectors
  unresolvedObjectionFor: (leadId: string) => ObjectionRecord | null;
  callAttemptsFor: (leadId: string) => number;
  reassignmentCount: (leadId: string) => number;
}

export const useCRM10x = create<CRM10xState>()(
  persist(
    (set, get) => ({
      profiles: {},
      objections: [],
      calls: [],
      visits: {},
      commitments: [],
      assignments: [],
      merges: [],
      coachingNotes: [],
      messageOutcomes: [],

      upsertProfile: (p) =>
        set((s) => ({
          profiles: {
            ...s.profiles,
            [p.leadId]: {
              ...(s.profiles[p.leadId] ?? { leadId: p.leadId, updatedAt: new Date().toISOString() }),
              ...p,
              updatedAt: new Date().toISOString(),
            },
          },
        })),

      addShiftingDate: (leadId, entry) =>
        set((s) => {
          const existing = s.profiles[leadId] ?? { leadId, updatedAt: new Date().toISOString() };
          const history = existing.shiftingHistory ?? [];
          const incomingDate = new Date(entry.shiftingDate).toISOString().slice(0, 10);
          const last = history[0];
          const lastDate = last ? new Date(last.shiftingDate).toISOString().slice(0, 10) : null;
          const lastTs = last ? +new Date(last.ts) : 0;
          if (lastDate === incomingDate && Date.now() - lastTs < 60_000) return {} as Partial<CRM10xState>;
          const newEntry: ShiftingDateEntry = { ...entry, ts: new Date().toISOString() };
          return {
            profiles: {
              ...s.profiles,
              [leadId]: {
                ...existing,
                preferredMoveInDate: entry.shiftingDate,
                shiftingHistory: [newEntry, ...history],
                updatedAt: new Date().toISOString(),
              },
            },
          };
        }),

      logObjection: (r) => {
        const rec: ObjectionRecord = { ...r, id: uid("obj"), ts: new Date().toISOString() };
        set((s) => ({ objections: [rec, ...s.objections] }));
        return rec;
      },
      resolveObjection: (id, resolution) =>
        set((s) => ({
          objections: s.objections.map((o) => (o.id === id ? { ...o, resolution } : o)),
        })),

      logCall: (r) => {
        const rec: CallRecord = { ...r, id: uid("call"), ts: new Date().toISOString() };
        set((s) => ({ calls: [rec, ...s.calls] }));
        // mirror best-call-time / language onto profile
        if (r.bestCallTime || r.language) {
          get().upsertProfile({
            leadId: r.leadId,
            ...(r.bestCallTime ? { bestCallTime: r.bestCallTime } : {}),
            ...(r.language ? { language: r.language } : {}),
          });
        }
        return rec;
      },

      upsertVisit: (v) =>
        set((s) => ({
          visits: {
            ...s.visits,
            [v.tourId]: {
              ...(s.visits[v.tourId] ?? { tourId: v.tourId, leadId: v.leadId }),
              ...v,
              updatedAt: new Date().toISOString(),
            },
          },
        })),

      addCommitment: (c) => {
        const rec: LeadCommitment = {
          ...c, id: uid("com"), ts: new Date().toISOString(), status: "pending",
        };
        set((s) => ({ commitments: [rec, ...s.commitments] }));
        return rec;
      },
      resolveCommitment: (id, status) =>
        set((s) => ({
          commitments: s.commitments.map((c) => (c.id === id ? { ...c, status } : c)),
        })),

      addAssignment: (a) => {
        const rec: AssignmentRecord = { ...a, id: uid("asn"), ts: new Date().toISOString() };
        set((s) => ({ assignments: [rec, ...s.assignments] }));
        return rec;
      },

      mergeDuplicates: (m) => {
        const rec: DuplicateMerge = { ...m, id: uid("mrg"), ts: new Date().toISOString() };
        set((s) => ({ merges: [rec, ...s.merges] }));
        return rec;
      },

      addCoachingNote: (n) => {
        const rec: CoachingNote = { ...n, id: uid("cn"), ts: new Date().toISOString() };
        set((s) => ({ coachingNotes: [rec, ...s.coachingNotes] }));
        return rec;
      },

      logMessageSend: (m) => {
        const rec: MessageOutcome = {
          ...m, id: uid("msg"), ts: new Date().toISOString(),
          replied: false, bookedAfter: false,
        };
        set((s) => ({ messageOutcomes: [rec, ...s.messageOutcomes] }));
        return rec;
      },
      markMessageReplied: (id) =>
        set((s) => ({
          messageOutcomes: s.messageOutcomes.map((m) => (m.id === id ? { ...m, replied: true } : m)),
        })),
      markMessageBookedAfter: (leadId, bookingId, bookingTs) => {
        const bookingTime = bookingTs ? +new Date(bookingTs) : Date.now();
        const WINDOW = 14 * 86_400_000;
        let changed = false;
        const messageOutcomes = get().messageOutcomes.map((m) => {
          if (m.leadId !== leadId) return m;
          if (m.attributedBookingId) return m;
          const sentTs = +new Date(m.ts);
          if (sentTs > bookingTime) return m;
          if (bookingTime - sentTs > WINDOW) return m;
          changed = true;
          return { ...m, bookedAfter: true, attributedBookingId: bookingId };
        });
        if (!changed) return;
        set({ messageOutcomes });
      },

      // selectors
      unresolvedObjectionFor: (leadId) => {
        const list = get().objections.filter(
          (o) => o.leadId === leadId && o.code !== "none" && o.resolution !== "yes",
        );
        return list[0] ?? null;
      },
      callAttemptsFor: (leadId) =>
        get().calls.filter((c) => c.leadId === leadId).length,
      reassignmentCount: (leadId) =>
        get().assignments.filter((a) => a.leadId === leadId).length,
    }),
    {
      name: "gharpayy.crm10x.v1",
      version: 1,
    },
  ),
);
