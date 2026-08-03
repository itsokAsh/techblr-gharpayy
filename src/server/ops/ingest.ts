import type { Intent, Lead } from "@/lib/types";
import { parseLead } from "@/lib/lead-identity/parser";
import { toMoveInIso } from "@/lib/lead-identity/normalize";
import { autoAssign } from "@/lib/routing";
import { phoneFingerprint } from "./phone";
import {
  addOpsLead,
  bumpCacheVersion,
  findLeadByPhoneHash,
  getCacheVersion,
  getOpsSnapshot,
  indexPhoneHash,
  uid,
} from "./store";
import type { OpsAuth } from "./types";

export interface IngestBody {
  /** Raw WhatsApp paste (preferred). */
  paste?: string;
  /** Or structured fields after client review. */
  name?: string;
  phone?: string;
  email?: string;
  location?: string;
  budget?: string | number;
  moveIn?: string;
  source?: string;
  /** Force create even if phone hash matches. */
  force?: boolean;
}

export type IngestResult =
  | {
      status: "created";
      leadId: string;
      name: string;
      phoneMasked: string;
      phoneHash: string;
      assignedTcmId: string;
      assignmentReasons: string[];
      cacheVersion: number;
    }
  | {
      status: "duplicate";
      leadId: string;
      name: string;
      phoneMasked: string;
      phoneHash: string;
      assignedTcmId: string;
      cacheVersion: number;
    }
  | {
      status: "error";
      code: "parse_failed" | "invalid_phone" | "forbidden";
      message: string;
    };

let indexWarmed = false;

async function warmPhoneIndex(): Promise<void> {
  if (indexWarmed) return;
  const { leads } = getOpsSnapshot();
  for (const lead of leads) {
    const fp = await phoneFingerprint(lead.phone);
    if (fp) indexPhoneHash(fp.hash, lead.id);
  }
  indexWarmed = true;
}

function parseBudget(raw: string | number | undefined): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (!raw) return 12000;
  const digits = String(raw).replace(/[^\d]/g, "");
  const n = parseInt(digits, 10);
  return Number.isFinite(n) && n > 0 ? (n < 1000 ? n * 1000 : n) : 12000;
}

export async function ingestLead(auth: OpsAuth, body: IngestBody): Promise<{ httpStatus: number; result: IngestResult }> {
  if (auth.role !== "tcm" && auth.role !== "flow-ops" && auth.role !== "admin") {
    return {
      httpStatus: 403,
      result: { status: "error", code: "forbidden", message: "Role cannot ingest leads" },
    };
  }

  await warmPhoneIndex();

  let name = body.name?.trim() ?? "";
  let phoneRaw = body.phone?.trim() ?? "";
  let email = body.email?.trim() ?? "";
  let location = body.location?.trim() ?? "";
  let budgetRaw: string | number | undefined = body.budget;
  let moveIn = body.moveIn?.trim() ?? "";

  if (body.paste?.trim()) {
    const parsed = parseLead(body.paste);
    if (!parsed && !phoneRaw && !name) {
      return {
        httpStatus: 400,
        result: { status: "error", code: "parse_failed", message: "Could not parse paste — need name or phone" },
      };
    }
    if (parsed) {
      name = name || parsed.name;
      phoneRaw = phoneRaw || parsed.phone;
      email = email || parsed.email;
      location = location || parsed.location || parsed.areas?.[0] || "";
      budgetRaw = budgetRaw ?? parsed.budget;
      moveIn = moveIn || parsed.moveIn;
    }
  }

  if (!name && !phoneRaw && !email) {
    return {
      httpStatus: 400,
      result: { status: "error", code: "parse_failed", message: "Need at least name, phone, or email" },
    };
  }

  const fp = await phoneFingerprint(phoneRaw);
  if (phoneRaw && !fp) {
    return {
      httpStatus: 400,
      result: { status: "error", code: "invalid_phone", message: "Invalid Indian mobile number" },
    };
  }

  const snap = getOpsSnapshot();

  if (fp && !body.force) {
    const existing = findLeadByPhoneHash(fp.hash);
    if (existing) {
      return {
        httpStatus: 200,
        result: {
          status: "duplicate",
          leadId: existing.id,
          name: existing.name,
          phoneMasked: fp.masked,
          phoneHash: fp.hash,
          assignedTcmId: existing.assignedTcmId,
          cacheVersion: getCacheVersion(),
        },
      };
    }
  }

  const preferredArea = location || "Unknown";
  const budget = parseBudget(budgetRaw);
  const intent: Intent = "warm";
  const nowIso = new Date().toISOString();
  const displayPhone = fp?.masked ?? (email ? "(email only)" : "—");

  const draftLead: Lead = {
    id: uid("ops"),
    name: name || "Unknown",
    // Store masked only in ops layer — CRM UI still gets real phone via local bridge
    phone: fp?.masked ?? (phoneRaw || "—"),
    source: body.source ?? "WhatsApp paste",
    budget,
    moveInDate: toMoveInIso(moveIn),
    preferredArea,
    assignedTcmId: "",
    stage: "new",
    intent,
    confidence: 50,
    tags: ["ops-ingest"],
    nextFollowUpAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    responseSpeedMins: 30,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const assignTcmId = auth.role === "tcm" ? auth.tcmId : undefined;
  const assignment = autoAssign(draftLead, snap.tcms, snap.leads, snap.tours);
  draftLead.assignedTcmId = assignTcmId ?? assignment.tcmId;

  addOpsLead(draftLead);
  if (fp) indexPhoneHash(fp.hash, draftLead.id);
  const cacheVersion = bumpCacheVersion();

  // Never log raw phone / paste
  console.info("[ops:ingest]", {
    leadId: draftLead.id,
    phoneHash: fp?.hash?.slice(0, 12),
    phoneMasked: fp?.masked,
    tcm: draftLead.assignedTcmId,
  });

  return {
    httpStatus: 201,
    result: {
      status: "created",
      leadId: draftLead.id,
      name: draftLead.name,
      phoneMasked: fp?.masked ?? displayPhone,
      phoneHash: fp?.hash ?? "",
      assignedTcmId: draftLead.assignedTcmId,
      assignmentReasons: assignment.reasons,
      cacheVersion,
    },
  };
}
