// Phone / email / name normalization for the identity engine.

/** Normalize an Indian phone number to E.164 (+91XXXXXXXXXX). Returns "" if invalid. */
export function normalizePhoneIN(input: string): string {
  if (!input) return "";
  const digits = input.replace(/\D/g, "");
  // Strip leading 0
  let d = digits.replace(/^0+/, "");
  // Strip 91 country prefix if present and we still have 10+ digits remaining
  if (d.startsWith("91") && d.length === 12) d = d.slice(2);
  // Indian mobile must be 10 digits starting 6-9
  if (!/^[6-9]\d{9}$/.test(d)) return "";
  return `+91${d}`;
}

/** Display-safe phone — last 4 digits only. Use in lists/modals; never log raw. */
export function maskPhoneDisplay(input: string | undefined | null): string {
  if (!input?.trim()) return "no phone";
  const e164 = normalizePhoneIN(input);
  const digits = (e164 || input).replace(/\D/g, "");
  const last10 = digits.slice(-10);
  if (last10.length < 4) return "••••";
  return `+91 ******${last10.slice(-4)}`;
}

export function normalizeEmail(input: string): string {
  if (!input) return "";
  const e = input.trim().toLowerCase();
  if (!/^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/.test(e)) return "";
  // Gmail: strip dots and +tag from local part
  const [local, domain] = e.split("@");
  if (domain === "gmail.com" || domain === "googlemail.com") {
    const stripped = local.split("+")[0].replace(/\./g, "");
    return `${stripped}@gmail.com`;
  }
  return e;
}

export function normalizeName(input: string): string {
  if (!input) return "";
  return input
    .toLowerCase()
    .replace(/\b(mr|mrs|ms|dr|shri|smt)\.?\b/g, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Coerce free-text move-in ("Last week of April") to a valid ISO date. */
export function toMoveInIso(raw: string | undefined | null): string {
  if (!raw?.trim()) return new Date().toISOString();
  const parsed = Date.parse(raw);
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  return new Date().toISOString();
}

export function isValidDateInput(raw: string | undefined | null): boolean {
  if (!raw?.trim()) return false;
  return !Number.isNaN(Date.parse(raw));
}

/** Parse a raw budget string like "₹8-12k" or "10000" into a single number (lower bound). */
export function parseBudgetToNumber(raw: string): number {
  if (!raw) return 0;
  const t = raw.toLowerCase().replace(/[₹,\s]/g, "");
  // Range "8-12k" → take lower
  const range = t.match(/(\d+(?:\.\d+)?)[-–to]+(\d+(?:\.\d+)?)(k)?/);
  if (range) {
    const lo = parseFloat(range[1]);
    const hi = parseFloat(range[2]);
    const k = !!range[3] || lo < 100;
    return Math.round((lo + hi) / 2 * (k ? 1000 : 1));
  }
  const single = t.match(/(\d+(?:\.\d+)?)(k)?/);
  if (single) {
    const v = parseFloat(single[1]);
    const k = !!single[2] || v < 100;
    return Math.round(v * (k ? 1000 : 1));
  }
  return 0;
}

export function newUlid(): string {
  // Crockford-base32-ish, 26 chars: timestamp(10) + random(16)
  const enc = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const ts = Date.now().toString(32).toUpperCase().padStart(10, "0").slice(-10);
  let rnd = "";
  for (let i = 0; i < 16; i++) rnd += enc[Math.floor(Math.random() * 32)];
  return `LD${ts}${rnd}`;
}
