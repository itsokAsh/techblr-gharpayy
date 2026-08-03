import type { TCM, Property, Lead, Tour, ActivityLog, FollowUp, HandoffMessage, ActiveSequence } from "./types";

const now = new Date();
const iso = (d: Date) => d.toISOString();
const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const addHours = (d: Date, n: number) => {
  const x = new Date(d);
  x.setHours(x.getHours() + n);
  return x;
};
const at = (d: Date, h: number, m = 0) => {
  const x = new Date(d);
  x.setHours(h, m, 0, 0);
  return x;
};

export const TCMS: TCM[] = [
  // Real Gharpayy TCM roster — sourced from the UTCMGG zone sheet so the
  // names, phones, Calendly links and area coverage match the ground team.
  { id: "tcm-1", name: "Abhay",   initials: "AB", zone: "Central · Koramangala", conversionRate: 0.34, avgResponseMins: 4,
    phone: "8307396042", email: "abhigharpayy@gmail.com",
    calendly: "https://calendly.com/thegharpayy/visit",
    areas: ["Koramangala", "BTM", "HSR", "Indiranagar", "Jayanagar", "JP Nagar", "SG Palya", "MG Road", "Tavarekere"] },
  { id: "tcm-2", name: "Satyam",  initials: "SA", zone: "MTP · Manyata",         conversionRate: 0.28, avgResponseMins: 7,
    phone: "8431513647", email: "gharmtech@gmail.com",
    calendly: "https://calendly.com/manyatagharpayy/visit-then-book-high-offers-100",
    areas: ["Manyata", "Hebbal", "Veerannapalya", "Nagawara", "Thanisandra", "HBR Layout", "Sarjapur", "Kalyan Nagar"] },
  { id: "tcm-3", name: "Abhinav", initials: "AV", zone: "MWB · Bellandur",       conversionRate: 0.22, avgResponseMins: 12,
    phone: "6363607724", email: "abhinav.gharpayy@gmail.com",
    calendly: "https://calendly.com/mwbgharpayy/new-meeting",
    areas: ["Bellandur", "Green Glen Layout"] },
  { id: "tcm-4", name: "Madhav",  initials: "MV", zone: "MWB · Whitefield",      conversionRate: 0.41, avgResponseMins: 3,
    phone: "8618728677", email: "madhav.gharpayy@gmail.com",
    areas: ["Mahadevapura", "Whitefield", "AECS Layout", "Marathahalli"] },
  { id: "tcm-5", name: "Gaurav",  initials: "GR", zone: "MWB · Marathahalli",    conversionRate: 0.31, avgResponseMins: 6,
    phone: "6398339301",
    areas: ["Marathahalli", "AECS Layout"] },
  { id: "tcm-6", name: "Namith",  initials: "NM", zone: "SJU · Jain Uni",        conversionRate: 0.36, avgResponseMins: 5,
    phone: "9113988864", email: "namithmgowda14@gmail.com",
    areas: ["SJU", "MCC", "CMS Jain", "Jain University", "Christ"] },
  { id: "tcm-7", name: "Azad",    initials: "AZ", zone: "YPR · BGR",             conversionRate: 0.29, avgResponseMins: 8,
    phone: "7988114576",
    calendly: "https://calendly.com/yprgharpayy/visit-then-book-high-offers-100",
    areas: ["Christ YPR", "Nagasandra", "HMT Layout", "Yeshwanthpur", "Peenya", "Dasarahalli", "Bannerghatta"] },
];

import { pgsAsProperties } from "./property-source";

// Legacy seed ids p-1..p-7 are referenced by the seeded TOURS / ACTIVITIES.
// We keep them as thin aliases (so referential integrity holds) but the rest
// of the catalog comes straight from the Property Hub PG database — no more
// dummy "Gharpayy Koramangala 5B" placeholders in the action picker.
const LEGACY_SEED: Property[] = [
  { id: "p-1", name: "Koramangala — Seed", area: "Koramangala", totalBeds: 24, vacantBeds: 6, version: 1, daysSinceLastBooking: 4, pricePerBed: 14000 },
  { id: "p-2", name: "Indiranagar — Seed", area: "Indiranagar", totalBeds: 18, vacantBeds: 9, version: 1, daysSinceLastBooking: 11, pricePerBed: 12500 },
  { id: "p-3", name: "HSR Layout — Seed", area: "HSR Layout", totalBeds: 12, vacantBeds: 2, version: 1, daysSinceLastBooking: 1, pricePerBed: 11000 },
  { id: "p-4", name: "Whitefield — Seed", area: "Whitefield", totalBeds: 32, vacantBeds: 14, version: 1, daysSinceLastBooking: 18, pricePerBed: 10500 },
  { id: "p-5", name: "BTM — Seed", area: "BTM", totalBeds: 16, vacantBeds: 0, version: 1,
    nextVacancyAt: iso(addDays(now, 4)), daysSinceLastBooking: 0, pricePerBed: 13000 },
  { id: "p-6", name: "Koramangala 8B — Seed", area: "Koramangala", totalBeds: 28, vacantBeds: 3, version: 1, daysSinceLastBooking: 2, pricePerBed: 14500 },
  { id: "p-7", name: "Whitefield Hope Farm — Seed", area: "Whitefield", totalBeds: 22, vacantBeds: 11, version: 1, daysSinceLastBooking: 9, pricePerBed: 10000 },
];

export const PROPERTIES: Property[] = [...pgsAsProperties(), ...LEGACY_SEED];

/* ------------------------------------------------------------------ */
/*  LEADS — distributed by TCM persona arc                              */
/*    tcm-1 Aarav (closer):     hot leads near close                    */
/*    tcm-2 Priya (nurturer):   mid-funnel + slipping post-tours        */
/*    tcm-3 Rohan (improving):  cold + overdue follow-ups               */
/*    tcm-4 Neha (hot streak):  back-to-back high-confidence tours      */
/* ------------------------------------------------------------------ */
export const LEADS: Lead[] = [
  /* ====== tcm-1 Aarav · Koramangala · closer ====== */
  { id: "l-1", name: "Karthik R.", phone: "+91 98xxx 12345", source: "Instagram",
    budget: 14000, moveInDate: iso(addDays(now, 3)), preferredArea: "Koramangala",
    assignedTcmId: "tcm-1", stage: "tour-scheduled", intent: "hot", confidence: 86,
    tags: ["budget-match"], nextFollowUpAt: iso(addHours(now, 6)), responseSpeedMins: 3,
    createdAt: iso(addDays(now, -2)), updatedAt: iso(addHours(now, -1)) },
  { id: "l-5", name: "Mohit J.", phone: "+91 97xxx 99021", source: "Instagram",
    budget: 13500, moveInDate: iso(addDays(now, 5)), preferredArea: "Koramangala",
    assignedTcmId: "tcm-1", stage: "tour-done", intent: "hot", confidence: 79,
    tags: ["second-tour"], nextFollowUpAt: iso(at(now, 18)), responseSpeedMins: 4,
    createdAt: iso(addDays(now, -4)), updatedAt: iso(now) },
  { id: "l-8", name: "Divya N.", phone: "+91 95xxx 22334", source: "Referral",
    budget: 15000, moveInDate: iso(addDays(now, 4)), preferredArea: "Koramangala",
    assignedTcmId: "tcm-1", stage: "tour-done", intent: "hot", confidence: 82,
    tags: ["location-mismatch"], nextFollowUpAt: iso(addDays(now, 1)), responseSpeedMins: 4,
    createdAt: iso(addDays(now, -4)), updatedAt: iso(addDays(now, -1)) },
  { id: "l-9", name: "Sanjay P.", phone: "+91 99xxx 41001", source: "Referral",
    budget: 14500, moveInDate: iso(addDays(now, 2)), preferredArea: "Koramangala",
    assignedTcmId: "tcm-1", stage: "negotiation", intent: "hot", confidence: 88,
    tags: ["decision-this-week"], nextFollowUpAt: iso(addHours(now, 4)), responseSpeedMins: 2,
    createdAt: iso(addDays(now, -6)), updatedAt: iso(addHours(now, -2)) },
  { id: "l-10", name: "Nitya K.", phone: "+91 98xxx 71200", source: "Google",
    budget: 13800, moveInDate: iso(addDays(now, 6)), preferredArea: "Koramangala",
    assignedTcmId: "tcm-1", stage: "tour-done", intent: "warm", confidence: 71,
    tags: ["second-tour-needed"], nextFollowUpAt: iso(addHours(now, 8)), responseSpeedMins: 5,
    createdAt: iso(addDays(now, -3)), updatedAt: iso(addHours(now, -3)) },
  { id: "l-11", name: "Aakash B.", phone: "+91 96xxx 11008", source: "Instagram",
    budget: 15500, moveInDate: iso(addDays(now, 1)), preferredArea: "Koramangala",
    assignedTcmId: "tcm-1", stage: "negotiation", intent: "hot", confidence: 92,
    tags: ["urgent", "ready-to-pay"], nextFollowUpAt: iso(addHours(now, 1)), responseSpeedMins: 1,
    createdAt: iso(addDays(now, -2)), updatedAt: iso(addMinutes(now, -30)) },

  /* ====== tcm-2 Priya · Indiranagar · nurturer ====== */
  { id: "l-2", name: "Ananya G.", phone: "+91 91xxx 55310", source: "Justdial",
    budget: 11000, moveInDate: iso(addDays(now, 7)), preferredArea: "Indiranagar",
    assignedTcmId: "tcm-2", stage: "negotiation", intent: "warm", confidence: 62,
    tags: ["price-issue"], nextFollowUpAt: iso(addDays(now, 1)), responseSpeedMins: 8,
    createdAt: iso(addDays(now, -5)), updatedAt: iso(addHours(now, -8)) },
  { id: "l-6", name: "Riya D.", phone: "+91 93xxx 31415", source: "Housing.com",
    budget: 13500, moveInDate: iso(addDays(now, 2)), preferredArea: "Indiranagar",
    assignedTcmId: "tcm-2", stage: "tour-done", intent: "hot", confidence: 78,
    tags: ["parents-involved"], nextFollowUpAt: null, responseSpeedMins: 5,
    createdAt: iso(addDays(now, -3)), updatedAt: iso(addDays(now, -1)) },
  { id: "l-12", name: "Tanya M.", phone: "+91 90xxx 70333", source: "Justdial",
    budget: 12000, moveInDate: iso(addDays(now, 9)), preferredArea: "Indiranagar",
    assignedTcmId: "tcm-2", stage: "tour-done", intent: "warm", confidence: 58,
    tags: ["second-thought"], nextFollowUpAt: iso(addDays(now, -1)), responseSpeedMins: 9,
    createdAt: iso(addDays(now, -8)), updatedAt: iso(addDays(now, -2)) },
  { id: "l-13", name: "Rahul V.", phone: "+91 94xxx 18825", source: "Google",
    budget: 12500, moveInDate: iso(addDays(now, 12)), preferredArea: "Indiranagar",
    assignedTcmId: "tcm-2", stage: "contacted", intent: "warm", confidence: 51,
    tags: ["needs-tour-2"], nextFollowUpAt: iso(addHours(now, 18)), responseSpeedMins: 11,
    createdAt: iso(addDays(now, -4)), updatedAt: iso(addDays(now, -1)) },
  { id: "l-14", name: "Pranav S.", phone: "+91 92xxx 44477", source: "Housing.com",
    budget: 11500, moveInDate: iso(addDays(now, 15)), preferredArea: "Indiranagar",
    assignedTcmId: "tcm-2", stage: "tour-done", intent: "warm", confidence: 64,
    tags: ["soft-yes"], nextFollowUpAt: iso(addDays(now, 2)), responseSpeedMins: 6,
    createdAt: iso(addDays(now, -7)), updatedAt: iso(addDays(now, -2)) },
  { id: "l-15", name: "Devika R.", phone: "+91 99xxx 33221", source: "Referral",
    budget: 13000, moveInDate: iso(addDays(now, 6)), preferredArea: "Indiranagar",
    assignedTcmId: "tcm-2", stage: "negotiation", intent: "warm", confidence: 67,
    tags: ["roommate-pending"], nextFollowUpAt: iso(addHours(now, 5)), responseSpeedMins: 7,
    createdAt: iso(addDays(now, -5)), updatedAt: iso(addHours(now, -10)) },

  /* ====== tcm-3 Rohan · HSR · improving (some overdue) ====== */
  { id: "l-3", name: "Vikram S.", phone: "+91 99xxx 88112", source: "Referral",
    budget: 9000, moveInDate: iso(addDays(now, 14)), preferredArea: "HSR Layout",
    assignedTcmId: "tcm-3", stage: "contacted", intent: "cold", confidence: 38,
    tags: ["budget-low"], nextFollowUpAt: iso(addDays(now, -1)), responseSpeedMins: 22,
    createdAt: iso(addDays(now, -6)), updatedAt: iso(addDays(now, -2)) },
  { id: "l-7", name: "Arjun K.", phone: "+91 98xxx 70011", source: "Google",
    budget: 12000, moveInDate: iso(addDays(now, 10)), preferredArea: "BTM",
    assignedTcmId: "tcm-3", stage: "tour-scheduled", intent: "warm", confidence: 48,
    tags: [], nextFollowUpAt: iso(addHours(now, 2)), responseSpeedMins: 14,
    createdAt: iso(addHours(now, -2)), updatedAt: iso(addHours(now, -2)) },
  { id: "l-16", name: "Manish T.", phone: "+91 91xxx 60099", source: "Justdial",
    budget: 10000, moveInDate: iso(addDays(now, 20)), preferredArea: "HSR Layout",
    assignedTcmId: "tcm-3", stage: "contacted", intent: "cold", confidence: 32,
    tags: ["ghosted-once"], nextFollowUpAt: iso(addDays(now, -2)), responseSpeedMins: 26,
    createdAt: iso(addDays(now, -10)), updatedAt: iso(addDays(now, -3)) },
  { id: "l-17", name: "Reema A.", phone: "+91 95xxx 80021", source: "Google",
    budget: 11500, moveInDate: iso(addDays(now, 8)), preferredArea: "HSR Layout",
    assignedTcmId: "tcm-3", stage: "tour-scheduled", intent: "warm", confidence: 55,
    tags: ["first-tour"], nextFollowUpAt: iso(addHours(now, 3)), responseSpeedMins: 13,
    createdAt: iso(addDays(now, -2)), updatedAt: iso(addHours(now, -5)) },
  { id: "l-18", name: "Faisal N.", phone: "+91 90xxx 13500", source: "Instagram",
    budget: 9500, moveInDate: iso(addDays(now, 30)), preferredArea: "HSR Layout",
    assignedTcmId: "tcm-3", stage: "contacted", intent: "cold", confidence: 28,
    tags: ["no-show", "far-out"], nextFollowUpAt: iso(addMinutes(now, -15)), responseSpeedMins: 31,
    createdAt: iso(addDays(now, -5)), updatedAt: iso(addHours(now, -2)) },

  /* ====== tcm-4 Neha · Whitefield · hot streak ====== */
  { id: "l-4", name: "Sneha P.", phone: "+91 90xxx 24681", source: "Google",
    budget: 16000, moveInDate: iso(addDays(now, 1)), preferredArea: "Whitefield",
    assignedTcmId: "tcm-4", stage: "tour-scheduled", intent: "hot", confidence: 91,
    tags: ["urgent"], nextFollowUpAt: iso(addHours(now, 3)), responseSpeedMins: 2,
    createdAt: iso(addDays(now, -1)), updatedAt: iso(addHours(now, -2)) },
  { id: "l-19", name: "Ritika G.", phone: "+91 98xxx 55501", source: "Instagram",
    budget: 14000, moveInDate: iso(addDays(now, 2)), preferredArea: "Whitefield",
    assignedTcmId: "tcm-4", stage: "tour-scheduled", intent: "hot", confidence: 89,
    tags: ["fast-mover"], nextFollowUpAt: iso(addHours(now, 5)), responseSpeedMins: 2,
    createdAt: iso(addDays(now, -1)), updatedAt: iso(addHours(now, -1)) },
  { id: "l-20", name: "Harsh V.", phone: "+91 92xxx 70044", source: "Google",
    budget: 13500, moveInDate: iso(addDays(now, 3)), preferredArea: "Whitefield",
    assignedTcmId: "tcm-4", stage: "tour-done", intent: "hot", confidence: 84,
    tags: ["closing-call"], nextFollowUpAt: iso(addHours(now, 2)), responseSpeedMins: 3,
    createdAt: iso(addDays(now, -2)), updatedAt: iso(addHours(now, -3)) },
  { id: "l-21", name: "Megha B.", phone: "+91 91xxx 88812", source: "Referral",
    budget: 15000, moveInDate: iso(addDays(now, 4)), preferredArea: "Whitefield",
    assignedTcmId: "tcm-4", stage: "negotiation", intent: "hot", confidence: 87,
    tags: ["price-aligned"], nextFollowUpAt: iso(addHours(now, 6)), responseSpeedMins: 3,
    createdAt: iso(addDays(now, -3)), updatedAt: iso(addHours(now, -4)) },
  { id: "l-22", name: "Yash D.", phone: "+91 97xxx 12490", source: "Instagram",
    budget: 14500, moveInDate: iso(addDays(now, 5)), preferredArea: "Whitefield",
    assignedTcmId: "tcm-4", stage: "tour-scheduled", intent: "hot", confidence: 81,
    tags: ["weekend-tour"], nextFollowUpAt: iso(addDays(now, 1)), responseSpeedMins: 3,
    createdAt: iso(addDays(now, -1)), updatedAt: iso(addHours(now, -2)) },
  { id: "l-23", name: "Aanya L.", phone: "+91 99xxx 70077", source: "Google",
    budget: 16500, moveInDate: iso(addDays(now, 7)), preferredArea: "Whitefield",
    assignedTcmId: "tcm-4", stage: "negotiation", intent: "hot", confidence: 86,
    tags: ["upgrade-room"], nextFollowUpAt: iso(addHours(now, 9)), responseSpeedMins: 4,
    createdAt: iso(addDays(now, -2)), updatedAt: iso(addHours(now, -3)) },
];

function addMinutes(d: Date, n: number) { const x = new Date(d); x.setMinutes(d.getMinutes() + n); return x; }

export const TOURS: Tour[] = [
  /* tcm-1 Aarav — closes lined up */
  { id: "t-1", leadId: "l-1", propertyId: "p-1", tcmId: "tcm-1",
    scheduledAt: iso(at(now, 11, 30)), status: "scheduled", decision: null,
    postTour: { outcome: null, confidence: 0, objection: null, objectionNote: "", expectedDecisionAt: null, nextFollowUpAt: null, filledAt: null },
    createdAt: iso(addDays(now, -1)), updatedAt: iso(addDays(now, -1)) },
  { id: "t-5", leadId: "l-8", propertyId: "p-1", tcmId: "tcm-1",
    scheduledAt: iso(at(addDays(now, -2), 10, 0)), status: "completed", decision: "thinking",
    postTour: { outcome: "thinking", confidence: 70, objection: "Location", objectionNote: "Far from office", expectedDecisionAt: iso(addDays(now, 1)), nextFollowUpAt: iso(addDays(now, 1)), filledAt: iso(addDays(now, -2)) },
    createdAt: iso(addDays(now, -3)), updatedAt: iso(addDays(now, -2)) },
  { id: "t-7", leadId: "l-10", propertyId: "p-6", tcmId: "tcm-1",
    scheduledAt: iso(at(addDays(now, -1), 16, 30)), status: "completed", decision: "thinking",
    postTour: { outcome: "thinking", confidence: 65, objection: "Roommate", objectionNote: "Wants to bring friend", expectedDecisionAt: iso(addDays(now, 2)), nextFollowUpAt: iso(addHours(now, 8)), filledAt: iso(addDays(now, -1)) },
    createdAt: iso(addDays(now, -2)), updatedAt: iso(addDays(now, -1)) },
  { id: "t-8", leadId: "l-11", propertyId: "p-6", tcmId: "tcm-1",
    scheduledAt: iso(at(now, 17, 0)), status: "scheduled", decision: null,
    postTour: { outcome: null, confidence: 0, objection: null, objectionNote: "", expectedDecisionAt: null, nextFollowUpAt: null, filledAt: null },
    createdAt: iso(addHours(now, -6)), updatedAt: iso(addHours(now, -6)) },

  /* tcm-2 Priya — slipping post-tour */
  { id: "t-3", leadId: "l-2", propertyId: "p-2", tcmId: "tcm-2",
    scheduledAt: iso(at(addDays(now, -1), 15, 0)), status: "completed", decision: "thinking",
    postTour: { outcome: "thinking", confidence: 55, objection: "Budget", objectionNote: "Wants 1k off", expectedDecisionAt: iso(addDays(now, 2)), nextFollowUpAt: iso(addDays(now, 1)), filledAt: iso(addDays(now, -1)) },
    createdAt: iso(addDays(now, -2)), updatedAt: iso(addDays(now, -1)) },
  { id: "t-4", leadId: "l-6", propertyId: "p-2", tcmId: "tcm-2",
    scheduledAt: iso(at(addDays(now, -1), 12, 0)), status: "completed", decision: null,
    completedAt: iso(addHours(now, -3)),
    postTour: { outcome: null, confidence: 0, objection: null, objectionNote: "", expectedDecisionAt: null, nextFollowUpAt: null, filledAt: null },
    createdAt: iso(addDays(now, -3)), updatedAt: iso(addHours(now, -3)) },
  { id: "t-9", leadId: "l-12", propertyId: "p-2", tcmId: "tcm-2",
    scheduledAt: iso(at(addDays(now, -2), 14, 0)), status: "completed", decision: null,
    completedAt: iso(addMinutes(now, -25)),
    postTour: { outcome: null, confidence: 0, objection: null, objectionNote: "", expectedDecisionAt: null, nextFollowUpAt: null, filledAt: null },
    createdAt: iso(addDays(now, -4)), updatedAt: iso(addMinutes(now, -25)) },
  { id: "t-10", leadId: "l-14", propertyId: "p-2", tcmId: "tcm-2",
    scheduledAt: iso(at(addDays(now, -3), 11, 0)), status: "completed", decision: "thinking",
    postTour: { outcome: "thinking", confidence: 60, objection: "Other Options", objectionNote: "Comparing 2 properties", expectedDecisionAt: iso(addDays(now, 4)), nextFollowUpAt: iso(addDays(now, 2)), filledAt: iso(addDays(now, -3)) },
    createdAt: iso(addDays(now, -5)), updatedAt: iso(addDays(now, -3)) },

  /* tcm-3 Rohan — improving */
  { id: "t-6", leadId: "l-3", propertyId: "p-3", tcmId: "tcm-3",
    scheduledAt: iso(at(addDays(now, 1), 10, 0)), status: "scheduled", decision: null,
    postTour: { outcome: null, confidence: 0, objection: null, objectionNote: "", expectedDecisionAt: null, nextFollowUpAt: null, filledAt: null },
    createdAt: iso(now), updatedAt: iso(now) },
  { id: "t-11", leadId: "l-17", propertyId: "p-3", tcmId: "tcm-3",
    scheduledAt: iso(addHours(now, 2)), status: "scheduled", decision: null,
    originallyScheduledAt: iso(addHours(now, 2)),
    vacancyConfirmedAt: null,
    postTour: { outcome: null, confidence: 0, objection: null, objectionNote: "", expectedDecisionAt: null, nextFollowUpAt: null, filledAt: null },
    createdAt: iso(addDays(now, -1)), updatedAt: iso(addHours(now, -5)) },

  /* tcm-4 Neha — back-to-back hot tours */
  { id: "t-2", leadId: "l-4", propertyId: "p-4", tcmId: "tcm-4",
    scheduledAt: iso(at(now, 16, 0)), status: "scheduled", decision: null,
    postTour: { outcome: null, confidence: 0, objection: null, objectionNote: "", expectedDecisionAt: null, nextFollowUpAt: null, filledAt: null },
    createdAt: iso(addDays(now, -1)), updatedAt: iso(addDays(now, -1)) },
  { id: "t-12", leadId: "l-19", propertyId: "p-4", tcmId: "tcm-4",
    scheduledAt: iso(at(now, 18, 0)), status: "scheduled", decision: null,
    postTour: { outcome: null, confidence: 0, objection: null, objectionNote: "", expectedDecisionAt: null, nextFollowUpAt: null, filledAt: null },
    createdAt: iso(addHours(now, -8)), updatedAt: iso(addHours(now, -8)) },
  { id: "t-13", leadId: "l-20", propertyId: "p-7", tcmId: "tcm-4",
    scheduledAt: iso(at(addDays(now, -1), 17, 0)), status: "completed", decision: "booked",
    postTour: { outcome: "booked", confidence: 92, objection: null, objectionNote: "Verbal yes — paperwork tomorrow", expectedDecisionAt: iso(addHours(now, 18)), nextFollowUpAt: iso(addHours(now, 6)), filledAt: iso(addDays(now, -1)) },
    createdAt: iso(addDays(now, -2)), updatedAt: iso(addDays(now, -1)) },
  { id: "t-14", leadId: "l-22", propertyId: "p-4", tcmId: "tcm-4",
    scheduledAt: iso(at(addDays(now, 1), 11, 0)), status: "scheduled", decision: null,
    postTour: { outcome: null, confidence: 0, objection: null, objectionNote: "", expectedDecisionAt: null, nextFollowUpAt: null, filledAt: null },
    createdAt: iso(addHours(now, -4)), updatedAt: iso(addHours(now, -4)) },
  /* demo: no-show rescue on Today */
  { id: "t-15", leadId: "l-18", propertyId: "p-3", tcmId: "tcm-3",
    scheduledAt: iso(at(addDays(now, -1), 11, 0)), status: "no-show", decision: null,
    noShowAt: iso(addHours(now, -2)),
    noShowReason: "didnt-answer",
    postTour: { outcome: null, confidence: 0, objection: null, objectionNote: "", expectedDecisionAt: null, nextFollowUpAt: null, filledAt: null },
    createdAt: iso(addDays(now, -3)), updatedAt: iso(addHours(now, -2)) },
  /* demo: vacancy lock — tour in 90m, property full */
  { id: "t-16", leadId: "l-7", propertyId: "p-5", tcmId: "tcm-3",
    scheduledAt: iso(addHours(now, 1.5)), status: "scheduled", decision: null,
    originallyScheduledAt: iso(at(addDays(now, 1), 10, 0)),
    vacancyConfirmedAt: null,
    postTour: { outcome: null, confidence: 0, objection: null, objectionNote: "", expectedDecisionAt: null, nextFollowUpAt: null, filledAt: null },
    createdAt: iso(addDays(now, -2)), updatedAt: iso(addHours(now, -4)) },
];

export const ACTIVITIES: ActivityLog[] = [
  { id: "a-1", ts: iso(addHours(now, -22)), kind: "tour_scheduled", actor: "tcm-1", leadId: "l-1", tourId: "t-1", propertyId: "p-1", text: "Tour scheduled with Karthik R. at Koramangala 5B" },
  { id: "a-2", ts: iso(addHours(now, -22)), kind: "message_sent", actor: "system", leadId: "l-1", tourId: "t-1", text: "WhatsApp confirmation sent to Karthik R." },
  { id: "a-3", ts: iso(addHours(now, -8)), kind: "tour_completed", actor: "tcm-2", leadId: "l-2", tourId: "t-3", text: "Tour completed — client liked the property" },
  { id: "a-4", ts: iso(addHours(now, -7)), kind: "decision_logged", actor: "tcm-2", leadId: "l-2", tourId: "t-3", text: "Decision: Thinking — Budget objection" },
  { id: "a-5", ts: iso(addHours(now, -3)), kind: "stale_alert", actor: "system", leadId: "l-6", tourId: "t-4", text: "Post-tour update missing for Riya D. — escalated" },
  { id: "a-6", ts: iso(addHours(now, -2)), kind: "tour_completed", actor: "tcm-4", leadId: "l-20", tourId: "t-13", text: "Neha closed Harsh V. — verbal yes!" },
  { id: "a-7", ts: iso(addHours(now, -1)), kind: "message_sent", actor: "tcm-1", leadId: "l-11", text: "Aarav: 'Block held until 6pm — bring ID + 1mo deposit.'" },
];

export const FOLLOWUPS: FollowUp[] = [
  /* tcm-1 — close-day stack */
  { id: "f-1", leadId: "l-9", tcmId: "tcm-1", dueAt: iso(addHours(now, 4)), priority: "high", done: false, reason: "Decision-day call — Sanjay" },
  { id: "f-5", tourId: "t-5", leadId: "l-8", tcmId: "tcm-1", dueAt: iso(addDays(now, 1)), priority: "high", done: false, reason: "Decision day approaching" },
  { id: "f-6", tourId: "t-7", leadId: "l-10", tcmId: "tcm-1", dueAt: iso(addHours(now, 8)), priority: "medium", done: false, reason: "Roommate confirmation" },
  { id: "f-7", leadId: "l-11", tcmId: "tcm-1", dueAt: iso(addHours(now, 1)), priority: "high", done: false, reason: "Block expires at 6pm" },

  /* tcm-2 — slipping */
  { id: "f-2", tourId: "t-4", leadId: "l-6", tcmId: "tcm-2", dueAt: iso(addHours(now, -3)), priority: "high", done: false, reason: "Post-tour update missing — Riya" },
  { id: "f-8", tourId: "t-9", leadId: "l-12", tcmId: "tcm-2", dueAt: iso(addHours(now, -1)), priority: "high", done: false, reason: "Post-tour empty — Tanya" },
  { id: "f-9", leadId: "l-13", tcmId: "tcm-2", dueAt: iso(addHours(now, 18)), priority: "medium", done: false, reason: "Schedule 2nd tour — Rahul" },
  { id: "f-10", leadId: "l-15", tcmId: "tcm-2", dueAt: iso(addHours(now, 5)), priority: "medium", done: false, reason: "Roommate decision pending" },

  /* tcm-3 — overdue cluster */
  { id: "f-3", leadId: "l-3", tcmId: "tcm-3", dueAt: iso(addDays(now, -1)), priority: "low", done: false, reason: "Re-engagement attempt — Vikram" },
  { id: "f-4", leadId: "l-7", tcmId: "tcm-3", dueAt: iso(addHours(now, 2)), priority: "medium", done: false, reason: "First contact — Arjun" },
  { id: "f-11", leadId: "l-16", tcmId: "tcm-3", dueAt: iso(addDays(now, -2)), priority: "low", done: false, reason: "Resurrect ghost — Manish" },
  { id: "f-12", leadId: "l-18", tcmId: "tcm-3", dueAt: iso(addDays(now, -1)), priority: "low", done: false, reason: "Move-in too far — sanity check" },
  { id: "f-16", tourId: "t-15", leadId: "l-18", tcmId: "tcm-3", dueAt: iso(addMinutes(now, -15)), priority: "high", done: false, reason: "No-show rescue · call now" },
  { id: "f-17", tourId: "t-15", leadId: "l-18", tcmId: "tcm-3", dueAt: iso(addHours(now, 20)), priority: "medium", done: false, reason: "No-show · offer new slot" },

  /* tcm-4 — close-day */
  { id: "f-13", tourId: "t-13", leadId: "l-20", tcmId: "tcm-4", dueAt: iso(addHours(now, 6)), priority: "high", done: false, reason: "Paperwork sign-off — Harsh" },
  { id: "f-14", leadId: "l-21", tcmId: "tcm-4", dueAt: iso(addHours(now, 6)), priority: "high", done: false, reason: "Negotiation close — Megha" },
  { id: "f-15", leadId: "l-23", tcmId: "tcm-4", dueAt: iso(addHours(now, 9)), priority: "medium", done: false, reason: "Upgrade-room confirm — Aanya" },
];

export const HANDOFFS: HandoffMessage[] = [
  { id: "h-1", leadId: "l-1", ts: iso(addHours(now, -23)),
    from: "flow-ops", fromId: "flow-ops", to: "tcm",
    text: "Hot lead — Instagram, urgent move-in (3 days). Wants Koramangala. Budget matches. Routed to Aarav.",
    priority: "urgent", read: true },
  { id: "h-2", leadId: "l-1", ts: iso(addHours(now, -22)),
    from: "tcm", fromId: "tcm-1", to: "flow-ops",
    text: "Got it. Tour scheduled 11:30. He confirmed on WA.",
    priority: "normal", read: true },
  { id: "h-3", leadId: "l-6", ts: iso(addHours(now, -3)),
    from: "flow-ops", fromId: "flow-ops", to: "tcm",
    text: "Riya's post-tour form is still empty. Parents are involved — please call before EOD.",
    priority: "urgent", read: false },
  { id: "h-4", leadId: "l-4", ts: iso(addHours(now, -5)),
    from: "tcm", fromId: "tcm-4", to: "flow-ops",
    text: "Sneha booked the slot. She's bringing dad. Block bed P4-12.",
    priority: "normal", read: false },
  { id: "h-5", leadId: "l-11", ts: iso(addHours(now, -2)),
    from: "tcm", fromId: "tcm-1", to: "flow-ops",
    text: "Aakash arriving 5pm. Block bed P6-04 + run a copy of the agreement.",
    priority: "urgent", read: false },
  { id: "h-6", leadId: "l-20", ts: iso(addHours(now, -1)),
    from: "tcm", fromId: "tcm-4", to: "hr",
    text: "Verbal yes from Harsh — booking tomorrow. Want Sara to recognise the streak in standup?",
    priority: "normal", read: false },
  { id: "h-7", leadId: "l-3", ts: iso(addHours(now, -4)),
    from: "hr", fromId: "hr-1", to: "tcm",
    text: "Rohan, Vikram is overdue 24h. Send a message before noon — even a soft one.",
    priority: "urgent", read: false },
];

export const SEQUENCES_INIT: ActiveSequence[] = [
  { id: "s-1", leadId: "l-2", kind: "post-tour", startedAt: iso(addHours(now, -8)), currentStep: 0, paused: false },
  { id: "s-2", leadId: "l-7", kind: "first-contact", startedAt: iso(addHours(now, -2)), currentStep: 0, paused: false },
  { id: "s-3", leadId: "l-8", kind: "pre-decision", startedAt: iso(addHours(now, -12)), currentStep: 1, paused: false },
  { id: "s-4", leadId: "l-16", kind: "cold-revival", startedAt: iso(addDays(now, -2)), currentStep: 2, paused: false },
  { id: "s-5", leadId: "l-21", kind: "pre-decision", startedAt: iso(addHours(now, -18)), currentStep: 1, paused: false },
];
