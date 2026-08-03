import type { Lead } from "./types";
import { LEADS } from "./mock-data";
import { normalizePhoneIN } from "@/lib/lead-identity/normalize";

/** User-created leads (from paste/direct intake) saved to localStorage. */
export interface CrmPersistSlice {
  userLeads: Lead[];
}

export function mergeSeedWithUserLeads(userLeads: Lead[]): Lead[] {
  const byUlid = new Set(userLeads.map((l) => l.identityUlid).filter(Boolean));
  const byPhone = new Set(
    userLeads.map((l) => normalizePhoneIN(l.phone)).filter(Boolean),
  );
  const rest = LEADS.filter((s) => {
    if (s.identityUlid && byUlid.has(s.identityUlid)) return false;
    const phone = normalizePhoneIN(s.phone);
    if (phone && byPhone.has(phone)) return false;
    return true;
  });
  return [...userLeads, ...rest];
}

export function pickUserLeads(leads: Lead[]): Lead[] {
  return leads.filter((l) => !!l.identityUlid);
}
