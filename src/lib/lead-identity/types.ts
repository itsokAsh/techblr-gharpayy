// Lead Identity, Dedup & Ownership — type definitions
// Mock-store layer; will migrate to Lovable Cloud in next pass.

export type LifecycleState =
  | "new"
  | "contacted"
  | "interested"
  | "visit-scheduled"
  | "visit-done"
  | "converted"
  | "dropped"
  | "dormant";

export type MatchType = "exact" | "strong" | "possible" | "new";

export type LeadQuality = "hot" | "good" | "bad" | null;
export type LeadPriority = "super-hot" | "hot" | "normal" | null;

export interface AssignmentEntry {
  ts: string;
  fromId: string | null;
  fromName: string | null;
  toId: string;
  toName: string;
  byActorId: string;
  byActorName: string;
  reason?: string;
}

export interface CustomTag {
  id: string;
  label: string;
  color: string;             // hex like #f97316
  createdBy: string;
  ts: string;
}

export type LeadPhaseNum = 1 | 2 | 3 | 4;
export type LeadStageTag =
  | "NEW" | "CONTACTED" | "TOUR_SCHEDULED" | "TOURED"
  | "NEGOTIATING" | "CLOSED" | "COLD" | "LOST";
export type InterestLevel = "HOT" | "WARM" | "COLD" | null;
export type ObjectionTagStr =
  | "PRICE-HIGH" | "LOCATION-MISMATCH" | "COMPARING" | "FAMILY-APPROVAL"
  | "TIMING" | "AMENITY-GAP" | "UNRESPONSIVE" | "SWITCHED-PLATFORM"
  | "PLANS-CHANGED" | "UNKNOWN";

export interface LeadAnchors {
  leadDate: string;
  tourDate?: string;
  checkInDate?: string;
}

export interface UnifiedLead {
  ulid: string;                 // Universal Lead ID
  /** CRM row id in `useApp` store — set by lead-identity bridge. */
  crmLeadId?: string;
  name: string;
  phoneE164: string;            // normalized: +91XXXXXXXXXX
  phoneRaw: string;
  email: string;
  emailNorm: string;
  area: string;
  areas?: string[];             // multi-area tokens (HSR, BTM, …)
  fullAddress?: string;         // long-form address / map link
  zone: string;                 // South / East / North / West / Central / "" or categorical bucket
  zoneCategory?: string;        // editor-chosen bucket (e.g. "KORA CORE")
  quality?: LeadQuality;        // hot / good / bad
  priority?: LeadPriority;      // super-hot = ASAP same-day-close
  tags?: string[];              // custom tag labels (WhatsApp-style)
  earliestCheckIn?: string;     // ISO date — earliest the lead CAN move in
  stage?: string;               // Lead stage label (MYT [TENANT], etc.)
  assigneeId?: string | null;
  assigneeName?: string | null;
  assignmentHistory?: AssignmentEntry[];
  budget: number;
  moveInDate: string;
  type: string;                 // Student / Working / etc
  room: string;                 // Private / Shared / Both
  need: string;                 // Boys / Girls / Coed
  inBLR: boolean | null;
  notes: string;
  state: LifecycleState;
  primaryOwnerId: string;
  secondaryOwnerId: string | null;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  rawSource?: string;           // original pasted text
  // ── Date-anchored execution engine ──
  anchors?: LeadAnchors;
  phase?: LeadPhaseNum;
  stageTag?: LeadStageTag;
  interestLevel?: InterestLevel;
  primaryObjection?: ObjectionTagStr | null;
  replied?: boolean;
  lastContactAt?: string;
  noShowFlag?: boolean;
  noShowCount?: number;
  followUpCount?: number;
  propertyName?: string;
  managerEscalated?: boolean;
  lostReason?: string;
  closedReason?: string;
}

export interface OwnershipHistoryEntry {
  ulid: string;
  ownerId: string;
  role: "primary" | "secondary";
  fromTs: string;
  toTs: string | null;
  reason: string;
}

export type AccessRequestState = "pending" | "approved" | "rejected" | "auto-escalated";

export interface AccessRequest {
  id: string;
  ulid: string;
  requesterId: string;
  requesterName: string;
  toOwnerId: string;
  ts: string;
  state: AccessRequestState;
  decidedAt?: string;
  message?: string;
}

export type ActivityKind =
  | "lead-created"
  | "lead-merged"
  | "owner-changed"
  | "secondary-added"
  | "access-requested"
  | "access-granted"
  | "access-rejected"
  | "call-logged"
  | "whatsapp-sent"
  | "visit-scheduled"
  | "visit-done"
  | "note-added"
  | "state-changed"
  | "reactivated"
  | "revived"
  | "tag-added"
  | "tag-removed"
  | "priority-changed"
  | "assignee-changed"
  | "earliest-checkin-set";

export interface ActivityEntry {
  id: string;
  ulid: string;
  ts: string;
  actorId: string;
  actorName: string;
  kind: ActivityKind;
  text: string;
  meta?: Record<string, unknown>;
}

export interface MatchCandidate {
  lead: UnifiedLead;
  score: number;       // 0-100
  reasons: string[];   // "phone exact", "name 0.92", ...
}

export interface MatchResult {
  type: MatchType;
  topScore: number;
  candidates: MatchCandidate[]; // ranked, max 5
}

export interface ParsedLeadDraft {
  name: string;
  phone: string;
  email: string;
  location: string;
  /** Distinct area tokens detected in the location/address text (e.g. ["HSR Layout","BTM"]). */
  areas: string[];
  /** Full address / map link / long-form location string when present. */
  fullAddress: string;
  budget: string;        // raw budget text
  moveIn: string;        // raw move-in text
  type: string;
  room: string;
  need: string;
  specialReqs: string;
  inBLR: boolean | null;
  zone: string;
  rawSource: string;
}
