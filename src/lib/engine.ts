/**
 * Arena Infrastructure — engine layer.
 * Pure functions. No state. Compose on top of the store.
 *
 * Encodes the real-life rules of the system:
 *   - SLA clocks (response, follow-up, post-tour)
 *   - Confidence decay (silence is the enemy)
 *   - Escalation thresholds
 *   - Smart "do next" prioritization
 */
import type { Lead, Tour, FollowUp, Intent, Property, PreTourCheck } from "./types";
import { PRE_TOUR_PROBLEM_LABELS } from "./types";

/* ============== SLA RULES ============== */

export const SLA = {
  firstResponseMins: 5,         // first response after lead arrives
  followUpHours: 24,            // every lead has a follow-up within 24h
  postTourHours: 1,             // post-tour form filled within 1h
  postTourAlertHours: 2,        // soft alert
  postTourEscalateHours: 6,     // hard escalation to Flow Ops
  reassignDays: 3,              // T+3 with no action → reassign
  noShowCallMins: 30,           // first rescue call after no-show
  noShowRescheduleHours: 24,    // offer new slot follow-up
  preTourVacancyHours: 3,       // confirm bed still free within 3h of tour
} as const;

export type SlaState = "ok" | "warn" | "breach";

export function slaForFollowUp(dueAt: string | null, now: number): SlaState {
  if (!dueAt) return "breach"; // no follow-up = breach
  const due = +new Date(dueAt);
  if (now > due) return "breach";
  if (due - now < 60 * 60 * 1000) return "warn"; // <1h
  return "ok";
}

/** Post-tour SLA clock starts at completion, not the original schedule time. */
export function postTourAnchorTs(tour: Tour): number {
  return +new Date(tour.completedAt ?? tour.updatedAt ?? tour.scheduledAt);
}

export function slaForPostTour(tour: Tour, now: number): SlaState {
  if (tour.status !== "completed" || tour.postTour.filledAt) return "ok";
  const elapsedHrs = (now - postTourAnchorTs(tour)) / 36e5;
  if (elapsedHrs >= SLA.postTourEscalateHours) return "breach";
  if (elapsedHrs >= SLA.postTourAlertHours) return "warn";
  // Still inside the 1h fill window
  if (elapsedHrs >= SLA.postTourHours) return "warn";
  return "ok";
}

export function slaForFirstResponse(lead: Lead): SlaState {
  if (lead.responseSpeedMins <= SLA.firstResponseMins) return "ok";
  if (lead.responseSpeedMins <= SLA.firstResponseMins * 3) return "warn";
  return "breach";
}

/** Tour needs a TCM pre-tour check (inside 3h window, or unresolved problem). */
export function needsVacancyLock(tour: Tour, now: number): boolean {
  if (tour.status !== "scheduled") return false;
  if (tour.preTourCheck?.outcome === "ok") return false;
  if (!tour.preTourCheck && tour.vacancyConfirmedAt) return false;
  const timing = preTourTiming(tour, now);
  if (tour.preTourCheck?.outcome === "problem") {
    return timing.isRequired || timing.phase === "overdue";
  }
  return timing.isRequired || timing.phase === "overdue";
}

/** Minutes until tour — negative if tour time passed. */
export function minsUntilTour(tour: Tour, now: number): number {
  return (+new Date(tour.scheduledAt) - now) / 60_000;
}

export type PreTourPhase = "optional" | "required" | "overdue" | "done" | "past";

export interface PreTourTiming {
  minsUntil: number;
  phase: PreTourPhase;
  /** e.g. "Tour in 2h 15m" or "Tour started 10m ago" */
  countdown: string;
  /** Inside 3h window — check is mandatory */
  isRequired: boolean;
  /** More than 3h away — TCM may log early */
  isOptionalAvailable: boolean;
  /** When the 3h mandatory window opens (ms epoch) */
  windowOpensAt: number;
  /** Tour slot ISO — check must be done before this */
  checkDueBy: string;
  /** Shown when >3h away: when mandatory window starts */
  windowOpensIn?: string;
}

/** Live timing vs tour.scheduledAt — same rules for seed + pasted leads. */
export function preTourTiming(tour: Tour, now: number): PreTourTiming {
  const minsUntil = minsUntilTour(tour, now);
  const windowMins = SLA.preTourVacancyHours * 60;
  const tourTs = +new Date(tour.scheduledAt);
  const windowOpensAt = tourTs - windowMins * 60_000;
  const base = {
    minsUntil,
    windowOpensAt,
    checkDueBy: tour.scheduledAt,
  };

  if (tour.status !== "scheduled") {
    return {
      ...base,
      phase: "past",
      countdown: "Tour not scheduled",
      isRequired: false,
      isOptionalAvailable: false,
    };
  }

  if (tour.preTourCheck?.outcome === "ok") {
    return {
      ...base,
      phase: "done",
      countdown: minsUntil > 0 ? `Tour in ${formatCountdown(minsUntil)}` : formatCountdown(-minsUntil) + " ago",
      isRequired: false,
      isOptionalAvailable: minsUntil > -15,
    };
  }

  if (minsUntil <= -15) {
    return {
      ...base,
      phase: "past",
      countdown: `Tour ${formatCountdown(-minsUntil)} ago`,
      isRequired: false,
      isOptionalAvailable: false,
    };
  }

  if (minsUntil > windowMins) {
    const opensInMins = (windowOpensAt - now) / 60_000;
    return {
      ...base,
      phase: "optional",
      countdown: `Tour in ${formatCountdown(minsUntil)}`,
      isRequired: false,
      isOptionalAvailable: true,
      windowOpensIn: opensInMins > 0 ? formatCountdown(opensInMins) : undefined,
    };
  }

  const phase: PreTourPhase = minsUntil > 0 ? "required" : "overdue";
  return {
    ...base,
    phase,
    countdown: minsUntil > 0
      ? `Tour in ${formatCountdown(minsUntil)}`
      : `Tour started ${formatCountdown(-minsUntil)} ago`,
    isRequired: true,
    isOptionalAvailable: false,
  };
}

export function isInsidePreTourWindow(tour: Tour, now: number): boolean {
  const t = preTourTiming(tour, now);
  return t.isRequired || t.phase === "overdue";
}

export function isVacancyAtRisk(
  property: Property | undefined,
  tourAt?: string,
  now = Date.now(),
  preTourCheck?: PreTourCheck | null,
): boolean {
  if (!property) return true;
  if (!tourAt) return property.vacantBeds <= 0;
  return !vacancyOutlook(property, tourAt, now, preTourCheck).availableForTour;
}

export interface VacancyOutlook {
  bedsNow: number;
  /** True if a bed should be free before or at tour time. */
  availableForTour: boolean;
  summary: string;
  actionHint?: string;
}

/** Forecast whether this property can host the tour — catalog + TCM check. */
export function vacancyOutlook(
  property: Property | undefined,
  tourAt: string,
  now: number,
  preTourCheck?: PreTourCheck | null,
): VacancyOutlook {
  if (preTourCheck?.outcome === "ok") {
    const beds = preTourCheck.bedsReported ?? property?.vacantBeds ?? 0;
    const tourTs = +new Date(tourAt);
    const nextTs = preTourCheck.nextBedAt ? +new Date(preTourCheck.nextBedAt) : null;
    const available = beds > 0 || (nextTs != null && !Number.isNaN(nextTs) && nextTs <= tourTs);
    return {
      bedsNow: beds,
      availableForTour: available,
      summary: beds > 0
        ? `TCM confirmed · ${beds} bed${beds === 1 ? "" : "s"} free`
        : available && preTourCheck.nextBedAt
          ? `TCM confirmed · bed expected ${formatTourSlot(preTourCheck.nextBedAt)}`
          : "TCM confirmed · no beds (recheck)",
    };
  }
  if (preTourCheck?.outcome === "problem") {
    return outlookFromTcmProblem(preTourCheck, tourAt);
  }
  return outlookFromCatalog(property, tourAt);
}

function outlookFromTcmProblem(check: PreTourCheck, tourAt: string): VacancyOutlook {
  const label = check.problemKind ? PRE_TOUR_PROBLEM_LABELS[check.problemKind] : "Issue reported";
  const beds = check.bedsReported ?? 0;
  const tourTs = +new Date(tourAt);
  const nextTs = check.nextBedAt ? +new Date(check.nextBedAt) : null;
  if (beds > 0) {
    return {
      bedsNow: beds,
      availableForTour: true,
      summary: `TCM update · ${beds} bed${beds === 1 ? "" : "s"} · note: ${label}`,
    };
  }
  if (nextTs != null && !Number.isNaN(nextTs) && nextTs <= tourTs) {
    return {
      bedsNow: 0,
      availableForTour: true,
      summary: `TCM: ${label} · bed expected ${formatTourSlot(check.nextBedAt!)}`,
      actionHint: "Recheck vacancy closer to tour time",
    };
  }
  const note = check.note?.trim() ? ` (${check.note.trim().slice(0, 48)}${check.note.length > 48 ? "…" : ""})` : "";
  return {
    bedsNow: beds,
    availableForTour: false,
    summary: `TCM flagged · ${label}${note}`,
    actionHint: "Cancel tour & rematch to another PG",
  };
}

function outlookFromCatalog(property: Property | undefined, tourAt: string): VacancyOutlook {
  if (!property) {
    return { bedsNow: 0, availableForTour: false, summary: "Property unknown", actionHint: "Cancel tour & rematch to another PG" };
  }
  if (property.vacantBeds > 0) {
    return {
      bedsNow: property.vacantBeds,
      availableForTour: true,
      summary: `${property.vacantBeds} bed${property.vacantBeds === 1 ? "" : "s"} free now`,
    };
  }
  const tourTs = +new Date(tourAt);
  const nextTs = property.nextVacancyAt ? +new Date(property.nextVacancyAt) : null;
  if (nextTs != null && !Number.isNaN(nextTs)) {
    if (nextTs <= tourTs) {
      return {
        bedsNow: 0,
        availableForTour: true,
        summary: `Full now · 1 bed expected ${formatTourSlot(property.nextVacancyAt!)} (before tour)`,
        actionHint: "Recheck vacancy closer to tour time",
      };
    }
    return {
      bedsNow: 0,
      availableForTour: false,
      summary: `Not available for this tour · next bed ~ ${formatTourSlot(property.nextVacancyAt!)}`,
      actionHint: "Cancel tour & rematch to another PG",
    };
  }
  return {
    bedsNow: 0,
    availableForTour: false,
    summary: "Full — no vacancy forecast from owner",
    actionHint: "Cancel tour & rematch to another PG",
  };
}

export function isSameTourSlot(a: string, b: string): boolean {
  const da = new Date(a);
  const db = new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return false;
  return (
    da.getFullYear() === db.getFullYear()
    && da.getMonth() === db.getMonth()
    && da.getDate() === db.getDate()
    && da.getHours() === db.getHours()
    && da.getMinutes() === db.getMinutes()
  );
}

/* ============== CONFIDENCE DECAY ============== */

/**
 * Live confidence — silence kills deals.
 *  - -1 per hour of silence after 6h
 *  - -5 if no follow-up scheduled
 *  - -8 if move-in date passed
 *  - +6 if move-in <= 3 days
 *  - +8 if a tour is already completed
 */
export function liveConfidence(lead: Lead, tours: Tour[], now: number): number {
  let s = lead.confidence;
  const silentHrs = (now - +new Date(lead.updatedAt)) / 36e5;
  if (silentHrs > 6) s -= Math.min(20, Math.floor(silentHrs - 6));
  if (!lead.nextFollowUpAt) s -= 5;
  // Response-speed is an ops metric — do not inflate score on first call.

  const moveInTs = +new Date(lead.moveInDate);
  if (!Number.isNaN(moveInTs)) {
    const days = (moveInTs - now) / (24 * 36e5);
    if (days < 0) s -= 8;
    else if (days <= 3) s += 6;
    else if (days >= 14) s -= 3;
  }

  if (tours.some((t) => t.leadId === lead.id && t.status === "completed")) s += 8;
  if (tours.some((t) => t.leadId === lead.id && t.decision === "booked")) s = 100;
  if (lead.stage === "dropped") s = Math.min(s, 15);
  if (lead.stage === "booked") s = 100;

  return Math.max(0, Math.min(100, Math.round(s)));
}

export function intentFor(confidence: number): Intent {
  if (confidence >= 75) return "hot";
  if (confidence >= 50) return "warm";
  return "cold";
}

/* ============== SMART "DO NEXT" QUEUE ============== */

export interface NextAction {
  leadId: string;
  reason: string;
  /** higher = do first */
  score: number;
  kind:
    | "post-tour-overdue"
    | "follow-up-overdue"
    | "follow-up-today"
    | "no-follow-up"
    | "first-response"
    | "tour-today"
    | "new-paste"
    | "tour-no-show-rescue"
    | "tour-vacancy-lock";
  dueAt?: string;
  /** Button label for the daily runbook */
  cta: string;
}

export function ctaForKind(kind: NextAction["kind"], opts?: { noShowCta?: "call" | "reschedule"; vacancyAtRisk?: boolean; hasProblem?: boolean }): string {
  switch (kind) {
    case "post-tour-overdue": return "Fill post-tour";
    case "follow-up-overdue": return "Do follow-up";
    case "follow-up-today": return "Follow up";
    case "no-follow-up": return "Set follow-up";
    case "first-response": return "Call now";
    case "tour-today": return "Open tour";
    case "new-paste": return "Call paste";
    case "tour-no-show-rescue": return opts?.noShowCta === "reschedule" ? "Reschedule" : "Call lead";
    case "tour-vacancy-lock": return opts?.vacancyAtRisk ? (opts?.hasProblem ? "Review problem" : "Rematch property") : (opts?.hasProblem ? "Edit check" : "Pre-tour check");
    default: return "Open";
  }
}

/** The single source-of-truth queue. Replaces "browse leads". */
export function buildDoNextQueue(
  leads: Lead[],
  tours: Tour[],
  followUps: FollowUp[],
  now: number,
  filterTcmId?: string,
  opts?: { uniqueByLead?: boolean; properties?: Property[]; tcms?: { id: string; name: string }[] },
): NextAction[] {
  const actions: NextAction[] = [];
  const properties = opts?.properties ?? [];
  const tcms = opts?.tcms ?? [];
  const byLead = (l: Lead) => !filterTcmId || l.assignedTcmId === filterTcmId;

  // 1. post-tour pending — highest priority (SLA starts at completedAt)
  tours
    .filter((t) => t.status === "completed" && !t.postTour.filledAt)
    .forEach((t) => {
      const lead = leads.find((l) => l.id === t.leadId);
      if (!lead || !byLead(lead)) return;
      if (lead.stage === "booked" || lead.stage === "dropped") return;
      const anchor = postTourAnchorTs(t);
      const elapsedMins = (now - anchor) / 60_000;
      const slaMins = SLA.postTourHours * 60;
      const remaining = slaMins - elapsedMins;
      const state = slaForPostTour(t, now);
      const reason =
        remaining > 0
          ? `Post-tour form due in ${formatRel(remaining)} · SLA ${SLA.postTourHours}h`
          : `Post-tour SLA ${state === "breach" ? "breach" : "warning"} · ${formatRel(-remaining)} late`;
      actions.push({
        leadId: lead.id,
        reason,
        kind: "post-tour-overdue",
        score: 1000 + Math.min(100, Math.max(0, -remaining) / 6),
        dueAt: new Date(anchor + slaMins * 60_000).toISOString(),
        cta: ctaForKind("post-tour-overdue"),
      });
    });

  // 1b. no-show rescue — missed tour, call then rebook
  tours
    .filter((t) => t.status === "no-show")
    .forEach((t) => {
      const lead = leads.find((l) => l.id === t.leadId);
      if (!lead || !byLead(lead)) return;
      if (lead.stage === "booked" || lead.stage === "dropped") return;
      const openRescue = followUps
        .filter((f) => f.tourId === t.id && !f.done && f.reason.startsWith("No-show"))
        .sort((a, b) => +new Date(a.dueAt) - +new Date(b.dueAt))[0];
      if (!openRescue) return;
      const minsToDue = (+new Date(openRescue.dueAt) - now) / 60_000;
      const isCall = openRescue.reason.includes("call");
      const overdue = minsToDue < 0;
      actions.push({
        leadId: lead.id,
        reason: overdue
          ? `No-show · ${isCall ? "call overdue" : "reschedule due"} · ${formatRel(-minsToDue)} late`
          : `No-show · ${isCall ? `call within ${formatRel(minsToDue)}` : `offer new slot in ${formatRel(minsToDue)}`}`,
        kind: "tour-no-show-rescue",
        score: 880 + Math.min(80, Math.max(0, -minsToDue) / 2) + intentBoost(lead.intent),
        dueAt: openRescue.dueAt,
        cta: ctaForKind("tour-no-show-rescue", { noShowCta: isCall ? "call" : "reschedule" }),
      });
    });

  // 1c. pre-tour vacancy lock — confirm bed still free within 3h of tour
  tours
    .filter((t) => needsVacancyLock(t, now))
    .forEach((t) => {
      const lead = leads.find((l) => l.id === t.leadId);
      if (!lead || !byLead(lead)) return;
      if (lead.stage === "booked" || lead.stage === "dropped") return;
      const prop = properties.find((p) => p.id === t.propertyId);
      const outlook = vacancyOutlook(prop, t.scheduledAt, now, t.preTourCheck);
      const atRisk = !outlook.availableForTour;
      const hasProblem = t.preTourCheck?.outcome === "problem";
      const timing = preTourTiming(t, now);
      const minsToTour = timing.minsUntil;
      const tcmName = tcms.find((x) => x.id === t.tcmId)?.name ?? "TCM";
      const slot = formatTourSlot(t.scheduledAt);
      const urgency = timing.phase === "overdue" ? "OVERDUE" : "REQUIRED";
      actions.push({
        leadId: lead.id,
        reason: hasProblem
          ? `${urgency} · ${timing.countdown} · ${outlook.summary} · ${tcmName}`
          : atRisk
            ? `${urgency} · ${timing.countdown} · ${outlook.summary} · ${tcmName}`
            : `Pre-tour check ${urgency.toLowerCase()} · ${timing.countdown} · ${slot} · ${tcmName}`,
        kind: "tour-vacancy-lock",
        score: 920 + Math.min(60, Math.max(0, (SLA.preTourVacancyHours * 60 - minsToTour) / 3)) + (atRisk ? 40 : 0) + (hasProblem ? 20 : 0),
        dueAt: t.scheduledAt,
        cta: ctaForKind("tour-vacancy-lock", { vacancyAtRisk: atRisk, hasProblem }),
      });
    });

  // 2. overdue follow-ups (skip provisional post-tour SLA + no-show rescue FUs)
  followUps
    .filter((f) => !f.done && +new Date(f.dueAt) < now && !f.reason.startsWith("Post-tour SLA") && !f.reason.startsWith("No-show"))
    .forEach((f) => {
      const lead = leads.find((l) => l.id === f.leadId);
      if (!lead || !byLead(lead)) return;
      if (lead.stage === "booked" || lead.stage === "dropped") return;
      const hrs = (now - +new Date(f.dueAt)) / 36e5;
      actions.push({
        leadId: lead.id,
        reason: `Follow-up overdue · ${f.reason}`,
        kind: "follow-up-overdue",
        score: 800 + Math.min(150, hrs * 2) + intentBoost(lead.intent),
        dueAt: f.dueAt,
        cta: ctaForKind("follow-up-overdue"),
      });
    });

  // 3. tours scheduled today
  tours
    .filter((t) => t.status === "scheduled" && sameDay(+new Date(t.scheduledAt), now))
    .forEach((t) => {
      const lead = leads.find((l) => l.id === t.leadId);
      if (!lead || !byLead(lead)) return;
      const minsToTour = (+new Date(t.scheduledAt) - now) / 60_000;
      actions.push({
        leadId: lead.id,
        reason: minsToTour > 0
          ? `Tour today in ${formatRel(minsToTour)}`
          : `Tour was ${formatRel(-minsToTour)} ago — confirm / complete`,
        kind: "tour-today",
        score: 700 + intentBoost(lead.intent) - Math.abs(minsToTour) / 30,
        dueAt: t.scheduledAt,
        cta: ctaForKind("tour-today"),
      });
    });

  // 4. follow-ups due today
  followUps
    .filter((f) => !f.done && sameDay(+new Date(f.dueAt), now) && +new Date(f.dueAt) >= now && !f.reason.startsWith("Post-tour SLA") && !f.reason.startsWith("No-show"))
    .forEach((f) => {
      const lead = leads.find((l) => l.id === f.leadId);
      if (!lead || !byLead(lead)) return;
      if (lead.stage === "booked" || lead.stage === "dropped") return;
      actions.push({
        leadId: lead.id,
        reason: `Follow-up today · ${f.reason}`,
        kind: "follow-up-today",
        score: 500 + intentBoost(lead.intent),
        dueAt: f.dueAt,
        cta: ctaForKind("follow-up-today"),
      });
    });

  // 5. freshly pasted / WhatsApp leads still on "new"
  leads
    .filter((l) => byLead(l) && l.stage === "new" && (l.identityUlid || /whatsapp|paste|direct/i.test(l.source)))
    .forEach((l) => {
      const ageMin = (now - +new Date(l.createdAt)) / 60_000;
      actions.push({
        leadId: l.id,
        reason: ageMin < 60
          ? `New paste · call within ${formatRel(Math.max(1, SLA.firstResponseMins - ageMin))}`
          : `Pasted lead waiting · ${formatRel(ageMin)} old`,
        kind: "new-paste",
        score: 950 + Math.min(50, ageMin / 2) + intentBoost(l.intent),
        dueAt: new Date(+new Date(l.createdAt) + SLA.firstResponseMins * 60_000).toISOString(),
        cta: ctaForKind("new-paste"),
      });
    });

  // 6. leads without any follow-up scheduled (and not closed / not brand-new paste)
  leads
    .filter((l) => byLead(l) && !l.nextFollowUpAt && l.stage !== "booked" && l.stage !== "dropped" && l.stage !== "new")
    .forEach((l) => {
      actions.push({
        leadId: l.id,
        reason: `No follow-up set · SLA breach`,
        kind: "no-follow-up",
        score: 600 + intentBoost(l.intent),
        cta: ctaForKind("no-follow-up"),
      });
    });

  // 7. other brand-new leads waiting for first response (non-paste)
  leads
    .filter((l) => byLead(l) && l.stage === "new" && !(l.identityUlid || /whatsapp|paste|direct/i.test(l.source)))
    .forEach((l) => {
      const ageMin = (now - +new Date(l.createdAt)) / 60_000;
      if (ageMin > SLA.firstResponseMins) {
        actions.push({
          leadId: l.id,
          reason: `First response overdue · created ${formatRel(ageMin)} ago`,
          kind: "first-response",
          score: 900 + Math.min(100, ageMin / 5),
          cta: ctaForKind("first-response"),
        });
      }
    });

  // de-dup by lead+kind, sort
  const seen = new Set<string>();
  let ranked = actions
    .sort((a, b) => b.score - a.score)
    .filter((a) => {
      const k = `${a.leadId}:${a.kind}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

  // Daily runbook mode: one highest-priority action per lead
  if (opts?.uniqueByLead !== false) {
    const byLeadSeen = new Set<string>();
    ranked = ranked.filter((a) => {
      if (byLeadSeen.has(a.leadId)) return false;
      byLeadSeen.add(a.leadId);
      return true;
    });
  }

  return ranked;
}

function intentBoost(i: Intent) {
  return i === "hot" ? 50 : i === "warm" ? 20 : 0;
}

function sameDay(a: number, b: number) {
  const da = new Date(a), db = new Date(b);
  return da.getFullYear() === db.getFullYear() &&
         da.getMonth() === db.getMonth() &&
         da.getDate() === db.getDate();
}

function formatTourSlot(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-IN", {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function formatCountdown(mins: number): string {
  const m = Math.abs(mins);
  if (m < 1) return "now";
  if (m < 60) return `${Math.round(m)}m`;
  const h = Math.floor(m / 60);
  const rem = Math.round(m % 60);
  if (h < 24) return rem > 0 ? `${h}h ${rem}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh > 0 ? `${d}d ${rh}h` : `${d}d`;
}

function formatRel(mins: number): string {
  if (mins < 1) return "now";
  if (mins < 60) return `${Math.round(mins)}m`;
  const h = mins / 60;
  if (h < 24) return `${h.toFixed(h < 10 ? 1 : 0)}h`;
  return `${Math.round(h / 24)}d`;
}

/* ============== TCM PERFORMANCE ============== */

export interface TcmPerformance {
  tcmId: string;
  leadCount: number;
  toursDone: number;
  bookings: number;
  conversion: number; // 0-100
  pendingPostTour: number;
  overdueFollowUps: number;
  discipline: number; // 0-100, higher = better
}

export function computeTcmPerformance(
  tcmId: string,
  leads: Lead[],
  tours: Tour[],
  followUps: FollowUp[],
  now: number,
): TcmPerformance {
  const myLeads = leads.filter((l) => l.assignedTcmId === tcmId);
  const myTours = tours.filter((t) => t.tcmId === tcmId);
  const toursDone = myTours.filter((t) => t.status === "completed").length;
  const bookings = myTours.filter((t) => t.decision === "booked").length;
  const conversion = toursDone > 0 ? Math.round((bookings / toursDone) * 100) : 0;
  const pendingPostTour = myTours.filter((t) => t.status === "completed" && !t.postTour.filledAt).length;
  const overdueFollowUps = followUps.filter((f) => f.tcmId === tcmId && !f.done && +new Date(f.dueAt) < now).length;
  const total = myLeads.length || 1;
  const discipline = Math.max(0, Math.min(100,
    100 - (pendingPostTour / total) * 100 - (overdueFollowUps / total) * 60,
  ));
  return {
    tcmId, leadCount: myLeads.length, toursDone, bookings, conversion,
    pendingPostTour, overdueFollowUps, discipline: Math.round(discipline),
  };
}
