import { normalizePhoneIN } from "@/lib/lead-identity/normalize";

/** SHA-256 hex of E.164 phone — used for dedup; never store/log raw phone. */
export async function hashPhoneE164(e164: string): Promise<string> {
  const data = new TextEncoder().encode(e164);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function phoneFingerprint(raw: string): Promise<{
  e164: string;
  hash: string;
  masked: string;
} | null> {
  const e164 = normalizePhoneIN(raw);
  if (!e164) return null;
  const hash = await hashPhoneE164(e164);
  const digits = e164.replace(/\D/g, "").slice(-10);
  const masked = `+91 ******${digits.slice(-4)}`;
  return { e164, hash, masked };
}

export function clientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip")
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "local"
  );
}
