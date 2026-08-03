// Paste-to-Lead parser. Handles WhatsApp forms, plain text, spreadsheet rows,
// emoji-heavy formats, AND unlabeled "casual" formats (name on line 1, bare
// phone/email/location/budget/move-in stacked vertically).
//
// IMPORTANT: Pre-normalises literal escape sequences (\r\n / \n / \r as text,
// not real newlines) that arrive when content is round-tripped through CSV
// exports, JSON dumps, or certain copy-paste paths. Also cuts each labeled
// field at the *next* label keyword (Phone:, Budget:, Move in:, etc.) so
// fields don't bleed into each other when pastes arrive on one physical line.
import type { ParsedLeadDraft } from "./types";

interface ZoneDef {
  zone: string;
  priority: number;
  keywords: string[];
}

const ZONES: ZoneDef[] = [
  {
    zone: "South", priority: 1,
    keywords: [
      "koramangala","kormangala","kormagalam","kormanagala","korma","btm layout","btm","jayanagar","jaynagar","jp nagar","jpnagar",
      "hsr layout","hsr","banashankari","basavanagudi","lalbagh","south end","southend",
      "electronic city","neeladri","begur","bommanahalli","hulimavu",
      "sg palya","silk board","silkboard","agara","madiwala","tavarekere",
      "christ university","bannerghatta","kanakapura","kalena agrahara",
      "hosur road","forum mall","vv puram","jayadev hospital",
      "jayanagar 9th","btm 2nd stage","btm stage 2","koramangala 3rd",
      "koramangala 4th","koramangala 5th","koramangala 6th",
      "umiya emporium","nexus mall",
    ],
  },
  {
    zone: "East", priority: 2,
    keywords: [
      "whitefield","white field","hopefarm","itpl","kundanahalli","kundalahalli","kadugodi",
      "brookfield","hoodi","garudacharpalya","varthur","nallurhalli","kr puram","seetharampalya","seetharam palya",
      "bellandur","sarjapur","ecospace","embassy tech village","prestige tech park","prestige technopark","yemalur",
      "indiranagar","indranagar","indira nagar","domlur","ejipura","murgeshpalya",
      "cv raman nagar","new thippasandra","old airport road","airport road","hal",
      "marathahalli","marathalli","mahadevapura","mahadevpura","bagmane","brigade tech",
      "kadubeesanahalli","kadubeesana","spice garden","phoenix market city","brigade metropolis",
      "rmz infinity","prestige shantiniketan","whitefield metro","aecs layout","aecs",
    ],
  },
  {
    zone: "North", priority: 3,
    keywords: [
      "yelahanka","hebbal","manyata tech","manyata","manyatha","nagawara","thanisandra",
      "jakkur","banaswadi","kalyan nagar","rt nagar","sahakara nagar","devanahalli",
      "vidyaranyapura","jalahalli","bhartiya","embassy boulevard",
      "nagasandra","hennur","peenya","yeshwanthpur","ypr",
    ],
  },
  {
    zone: "West", priority: 4,
    keywords: [
      "rajajinagar","vijaynagar","vijaya nagar","yeswanthpur",
      "nagarbhavi","chord road","mahalakshmi layout","malleshwaram","tumkur road",
      "sanjayanagara","chandra layout",
    ],
  },
  {
    zone: "Central", priority: 5,
    keywords: [
      "mg road","brigade road","richmond road","richmond circle","shanthinagar",
      "ashok nagar","vittal mallya","jayamahal","majestic",
      "gandhi nagar","frazer town","cubbon park","ub city","vasanth nagar",
      "trinity circle","halasuru","church street","lavelle road",
      "residency road","museum road","adugodi","wilson garden","cunningham",
    ],
  },
];

export function detectZone(rawText: string): string {
  if (!rawText) return "";
  const t = rawText.toLowerCase();
  for (const z of [...ZONES].sort((a, b) => a.priority - b.priority)) {
    if (z.keywords.some((kw) => t.includes(kw))) return z.zone;
  }
  return "";
}

const EMOJI_RE = /[📝📱✉️📍💰📆📅👨🏢👫✨💥💯⚡🔥💛😘🏠🎯👥📞👤💼🛏️]/g;

const LOCATION_HINTS = [
  ...ZONES.flatMap((z) => z.keywords),
  "near","opposite","mall","road","layout","circle","stage","cross","main",
  "metro","station","colony","nagar","palya","puram","halli","village",
];

const NON_NAME_TOKENS = /\b(name|phone|mobile|email|location|area|budget|move|moving|room|need|special|request|profession|working|student|intern|girls?|boys?|coed|private|shared|sharing|single|double|triple|ac|veg|gym|preferred|in\s*blr|out\s*of)\b/i;

// All known label keywords used to *terminate* a previous field's value when
// a paste arrives on one physical line (no real newlines).
const LABEL_TERMINATORS =
  "(?:Name|Phone|Mobile|Ph|Contact|Email|E-mail|Mail|" +
  "Preferred\\s*Location|Location|Area|Landmark|Map\\s*link|" +
  "Budget(?:\\s*Range)?|Budjet|Actual\\s*budget|" +
  "Move[-\\s]?in(?:[-\\s]?Date)?|Moving(?:\\s*Date)?|Movein|" +
  "Profession|Occupation|Working|Student|Intern|" +
  "Room(?:\\s*Type)?|Sharing|" +
  "Need|NEED|Cohort|" +
  "Special\\s*Requests?|Special\\s*Request|Notes?|Remarks?|" +
  "How\\s*Many\\s*Members|Members?)";

const LABEL_TERMINATOR_LOOKAHEAD = new RegExp(`\\s+${LABEL_TERMINATORS}\\s*[:\\-–]`, "i");

/** Cut a captured field value at the start of the next label keyword. */
function cutAtNextLabel(value: string): string {
  if (!value) return value;
  const m = value.match(LABEL_TERMINATOR_LOOKAHEAD);
  if (m && m.index !== undefined) return value.slice(0, m.index);
  return value;
}

/** Pre-normalise raw paste: convert literal escape sequences and CRLF to \n. */
function normalisePaste(raw: string): string {
  return raw
    // First handle literal \r\n / \n / \r escape sequences (4-char strings)
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n")
    .replace(/\\t/g, " ")
    // Then real CRLF
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

function looksLikeName(line: string): boolean {
  const t = line.trim();
  if (!t || t.length < 2 || t.length > 50) return false;
  if (/\d/.test(t)) return false;
  if (/@/.test(t)) return false;
  if (NON_NAME_TOKENS.test(t)) return false;
  if (LOCATION_HINTS.some((k) => t.toLowerCase().includes(k))) return false;
  const words = t.replace(/[^a-zA-Z\s.]/g, "").trim().split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 5) return false;
  return /^[A-Z]/.test(words[0]) || /^[a-z]/.test(words[0]);
}

function looksLikeLocation(line: string): boolean {
  const t = line.trim().toLowerCase();
  if (!t || t.length > 120) return false;
  if (/\d{5,}/.test(t)) return false;
  if (/@/.test(t)) return false;
  return LOCATION_HINTS.some((k) => t.includes(k));
}

function looksLikeBudget(line: string): boolean {
  const t = line.trim().toLowerCase().replace(/[₹,\s]/g, "");
  return /^\d{3,6}$/.test(t) ||
    /^\d+(?:\.\d+)?k$/i.test(t) ||
    /^\d+[-–to]+\d+k?$/i.test(t) ||
    /^\d+k?[-–to/]+\d+k?$/i.test(t);
}

function looksLikeDate(line: string): boolean {
  const t = line.trim().toLowerCase();
  if (t.length > 40) return false;
  return /^(immediate|asap|now|today|tomorrow)/i.test(t) ||
    /\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}/.test(t) ||
    /\d{1,2}(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(t) ||
    /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}/i.test(t) ||
    /(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i.test(t);
}

function normalizeRoom(text: string): string {
  const t = text.toLowerCase();
  const hasPrivate = /\b(private|single|1\s*sharing|1bhk|studio)\b/.test(t);
  const hasShared = /\b(shared|sharing|double|2\s*sharing|triple|3\s*sharing|twin)\b/.test(t);
  if (hasPrivate && hasShared) return "Both";
  if (hasPrivate) return "Private";
  if (hasShared) return "Shared";
  return "";
}

/** Title-case a name string, preserving common patronymic letters. */
function titleCase(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export function parseLead(raw: string): ParsedLeadDraft | null {
  if (!raw || raw.trim().length < 4) return null;

  // Normalise escape sequences and CRLF up front
  const normalised = normalisePaste(raw);
  const clean = normalised
    .replace(/\*{1,2}([^*\n]+)\*{1,2}/g, "$1")
    .replace(/_{1,3}([^_\n]+)_{1,3}/g, "$1")
    .replace(/`([^`]+)`/g, "$1");

  const grab = (...patterns: RegExp[]): string => {
    for (const re of patterns) {
      const m = clean.match(re);
      if (m?.[1]) {
        let v = m[1].replace(EMOJI_RE, "").trim();
        v = cutAtNextLabel(v);
        return v.replace(/^[\s,;:|.\-–—]+|[\s,;:|.\-–—]+$/g, "").trim();
      }
    }
    return "";
  };

  // ---------- Phone ----------
  // Accept tightly packed (9876543210), with country code, hyphens, spaces,
  // or split into 3+3+4 / 4+3+3 groups. We strip non-digits then re-validate.
  let phone = "";
  const digitOnly = clean.replace(/[^\d]/g, "");
  // Find a 10-digit Indian mobile inside the digit-only stream (optionally
  // prefixed by 91), but only if it appears as a recognisable run in the raw.
  const tightMatch = clean.match(/(?:\+?\s*91[-\s]?)?(?:\d[-\s]?){9,12}\d/);
  if (tightMatch) {
    const candidate = tightMatch[0].replace(/[^\d]/g, "");
    const trimmed = candidate.replace(/^91/, "");
    const m = trimmed.match(/[6-9]\d{9}/);
    if (m) phone = m[0];
  }
  if (!phone) {
    const m = digitOnly.match(/[6-9]\d{9}/);
    if (m) phone = m[0];
  }

  // ---------- Email ----------
  const emailMatch = clean.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  const email = emailMatch?.[0] ?? "";

  // ---------- Name ----------
  // Allow leading emoji / bullets (📝 *Name:*) — Gharpayy WhatsApp forms put
  // an emoji before the label, so ^\s*Name misses them while Phone/Email still
  // match via digit/@ patterns.
  let name = grab(
    /(?:^|\n)[^\S\n]*[^\n\w]*Name\s*[:\-–*]+\s*([^\n,📱\d]{2,60})/im,
    /\bName\s*[:\-–*]+\s*([A-Za-z][A-Za-z.'\-\s]{0,50}?)(?=\s*(?:📱|Phone|Mobile|Email|E-mail|Preferred|Location|Budget|Move|$|\n))/im,
    /(?:^|\n)\s*\.Name\s+([^\n.]{2,60})/im,
    /(?:^|\n)\s*[-–]\s*([A-Z][a-z][^\n\d]{1,40})\s*\n/m,
  );
  // Defensive: name may still contain trailing label fragments after newline
  // collapse — strip up to first digit / @ / known label.
  if (name) {
    name = name
      .split(/\s+(?:Phone|Mobile|Email|Location|Budget|Move|Moving|Working|Student|Room|Need)\b/i)[0]
      .replace(/[\d@].*$/, "")
      .replace(/^\W+|\W+$/g, "")
      .trim();
  }

  if (!name) {
    const lines = clean.split("\n").map((l) => l.trim()).filter(Boolean);
    for (const line of lines.slice(0, 3)) {
      const stripped = line
        .replace(EMOJI_RE, "")
        .replace(/^[-–*•]\s*/, "")
        .replace(/^Name\s*[:\-–*]+\s*/i, "")
        .trim();
      const inlineMatch = stripped.match(/^([A-Za-z][A-Za-z\s.]{1,40}?)\s+(?:\+?91)?[6-9]\d{9}/);
      if (inlineMatch) { name = inlineMatch[1].trim(); break; }
      if (looksLikeName(stripped)) { name = stripped; break; }
    }
  }
  if (name) name = titleCase(name);

  // ---------- Location ----------
  let location = grab(
    /Preferred\s*Location[^:\n]*[:\-–]+\s*([^\n💰📆👨🏢]{3,200})/i,
    /Which\s+location\s*[:\-–]+\s*([^\n]{3,200})/i,
    /Location\s*[:\-–]+\s*([^\n💰📆👨🏢]{3,200})/i,
    /Area\s*[:\-–]+\s*([^\n]{3,200})/i,
    /Landmark[^:\n]*[:\-–]+\s*([^\n]{3,200})/i,
  );
  // Strip embedded map links
  location = location.replace(/\(Map\s*link\)|https?:\/\/\S+/gi, "").trim();

  if (!location) {
    for (const line of clean.split("\n").map((l) => l.trim())) {
      if (looksLikeLocation(line) && !looksLikeBudget(line)) {
        location = line.replace(EMOJI_RE, "").trim();
        break;
      }
    }
  }

  // ---------- Budget ----------
  let budget = grab(
    /(?:Actual\s*budget|Budget\s*Range|Budget\s*range|Budget\s*is|Budget|Budjet)\s*[:\-–(]*\s*([^\n)📆👨🏢]{2,80})/i,
  ).replace(/[₹()\[\]]/g, "").replace(/\s+/g, " ").trim();

  if (!budget) {
    for (const line of clean.split("\n").map((l) => l.trim())) {
      if (looksLikeBudget(line)) { budget = line.replace(/[₹]/g, "").trim(); break; }
    }
  }

  // ---------- Move-in ----------
  let moveIn = grab(
    /Move[-\s]?in[-\s]?Date\s*[:\-–😘*]+\s*([^\n👨🏢👫✨]{2,80})/i,
    /Moving\s*Date\s*[:\-–]+\s*([^\n]{2,60})/i,
    /Move[-\s]?in\s*[:\-–]+\s*([^\n]{2,60})/i,
    /Movein\s*[:\-–]+\s*([^\n]{2,60})/i,
  );

  if (!moveIn) {
    for (const line of clean.split("\n").map((l) => l.trim())) {
      if (looksLikeDate(line) && !looksLikeBudget(line)) { moveIn = line; break; }
    }
  }

  // ---------- Type ----------
  const isWorking = /\bworking\b|\bprofessional\b|\banalyst\b|\banalysist\b|\bmarketer\b|\bengineer\b|\bdeveloper\b|\bemployee\b/i.test(clean);
  const isStudent = /\bstudent\b/i.test(clean);
  const isIntern = /\bintern(?:ing)?\b/i.test(clean);
  const type = isWorking && isStudent ? "Student/Working"
    : isWorking ? "Working"
    : isStudent ? "Student"
    : isIntern ? "Intern" : "";

  // ---------- Room ----------
  const roomLabeled = grab(/Room(?:\s*Type)?\s*[*:\-–(]+\s*([^\n👫✨📞]{2,60})/i);
  const room = normalizeRoom(roomLabeled || clean);

  // ---------- Need ----------
  const needRaw = grab(
    /NEED\s*[*:\-–(]+\s*([^\n✨📞]{2,60})/i,
    /Need\s*[:\-–]+\s*([^\n]{2,60})/i,
    /Cohort\s*[:\-–]+\s*([^\n]{2,60})/i,
  ).toLowerCase();
  const wantGirls = needRaw.includes("girl") || /\bgirls?\s*(?:pg|preferable|only)?/i.test(clean);
  const wantBoys = needRaw.includes("boy") || /\bboys?\b/i.test(clean);
  const wantCoed = needRaw.includes("coed") || /\bcoed\b/i.test(clean);
  const need = [wantGirls && "Girls", wantBoys && "Boys", wantCoed && "Coed"].filter(Boolean).join(" / ");

  // ---------- Special requests ----------
  let specialReqs = grab(
    /Special\s*Requests?\s*[*:\-–(]+\s*([^\n*📞]{2,200})/i,
    /Notes?\s*[:\-–]+\s*([^\n]{2,200})/i,
    /Remarks?\s*[:\-–]+\s*([^\n]{2,200})/i,
  ).replace(/\b(NA|None|n\/a|If any)\b/gi, "").trim();

  if (!specialReqs) {
    const consumed = new Set<string>();
    [name, phone, email, location, budget, moveIn].forEach((v) => v && consumed.add(v.toLowerCase().trim()));
    const extras: string[] = [];
    for (const rawLine of clean.split("\n")) {
      const line = rawLine.replace(EMOJI_RE, "").trim();
      if (!line || line.length < 4 || line.length > 200) continue;
      const lower = line.toLowerCase();
      if (consumed.has(lower)) continue;
      if (/\d{6,}/.test(line)) continue;
      if (/@/.test(line)) continue;
      if (looksLikeBudget(line) || looksLikeDate(line)) continue;
      if (NON_NAME_TOKENS.test(line) && !/\b(veg|non[- ]?veg|ac|gym|wifi|food|parking|pet|ventilation|spacious|clean|backup|family|balcony|attached|sunlight|quiet|washroom)\b/i.test(line)) continue;
      if (/\b(veg|non[- ]?veg|ac|gym|wifi|food|parking|pet|ventilation|spacious|clean|backup|family|quiet|sunlight|balcony|attached|washroom)\b/i.test(line)
          || (/^[A-Za-z]/.test(line) && line.split(/\s+/).length >= 3)) {
        extras.push(line);
      }
    }
    specialReqs = extras.join("; ").slice(0, 240);
  }

  const inBLRTrue = /\bin\s*blr\b|in bangalore|currently in bangalore|already here|yes.*blr/i.test(normalised);
  const inBLRFalse = /not in blr|not in bangalore|outside bangalore|relocating|out.*blr/i.test(normalised);
  const inBLR = inBLRTrue ? true : inBLRFalse ? false : null;

  const zone = detectZone(normalised);

  // Extract distinct area tokens from the captured location + raw text
  const areaPool = `${location} ${normalised}`.toLowerCase();
  const areaSet = new Set<string>();
  for (const z of ZONES) {
    for (const kw of z.keywords) {
      if (kw.length < 4) continue;
      if (areaPool.includes(kw)) {
        // canonical-case version
        areaSet.add(kw.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" "));
      }
    }
  }
  const areas = [...areaSet].slice(0, 6);

  // Full address = map link / URL OR location lines >60 chars OR explicit "Full Address" label
  let fullAddress = "";
  const urlMatch = normalised.match(/https?:\/\/\S+/);
  if (urlMatch) fullAddress = urlMatch[0];
  if (!fullAddress) {
    const longLine = normalised.split("\n").map((l) => l.trim()).find((l) => l.length > 60 && /\d/.test(l) && !/@/.test(l));
    if (longLine) fullAddress = longLine;
  }
  const labeledFull = grab(/Full\s*Address\s*[:\-–]+\s*([^\n]{5,300})/i);
  if (labeledFull) fullAddress = labeledFull;

  if (!phone && !email && !name) return null;

  return {
    name, phone, email, location, areas, fullAddress,
    budget, moveIn,
    type, room, need, specialReqs, inBLR, zone,
    rawSource: raw,
  };
}

export function splitLeads(text: string): string[] {
  const norm = normalisePaste(text);
  const lines = norm.split("\n");
  const chunks: string[] = [];
  let cur: string[] = [];

  const isOpener = (line: string): boolean => {
    const t = line.trim();
    if (t.length < 3) return false;
    return (
      /^📝/.test(t) ||
      /^\*?GHARPAYY/i.test(t) ||
      /^(?:\*?\s*Name\s*[:\-–*])/i.test(t) ||
      /^Name\s*[-–]/i.test(t) ||
      /^\.Name\s/i.test(t) ||
      /^\[[\d:]+\s*(AM|PM),\s*\d/.test(t) ||
      /^[A-Z][a-zA-Z]{1,20}\s+[6-9]\d{9}/.test(t) ||
      /^[A-Z][a-zA-Z\s]{2,30}\s+[6-9]\d{9}/.test(t) ||
      /^(?:\+91[-\s]?)?[6-9]\d{9}\b/.test(t) ||
      /^[-–]\s*[A-Z][a-z]/.test(t) ||
      /^\*?Name\s*:/i.test(t)
    );
  };

  const isJunk = (line: string): boolean => {
    const t = line.trim();
    return !t ||
      /^(not filled|no|n\/a|xyz|3405|na)$/i.test(t) ||
      /^[\-–=*_]{3,}$/.test(t);
  };

  for (const line of lines) {
    if (isJunk(line)) {
      if (cur.length) { chunks.push(cur.join("\n")); cur = []; }
      continue;
    }
    if (cur.length === 0) {
      cur.push(line);
    } else if (isOpener(line)) {
      chunks.push(cur.join("\n"));
      cur = [line];
    } else {
      cur.push(line);
    }
  }
  if (cur.length) chunks.push(cur.join("\n"));
  return chunks.filter((c) => c.trim().length > 4);
}
