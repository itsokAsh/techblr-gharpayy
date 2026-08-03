import type { OpsAuth, OpsRole } from "./types";

const ROLES: OpsRole[] = ["tcm", "flow-ops", "hr", "owner", "admin"];

export function parseOpsAuth(request: Request): OpsAuth {
  const roleHeader = request.headers.get("x-role") ?? "tcm";
  const role = (ROLES.includes(roleHeader as OpsRole) ? roleHeader : "tcm") as OpsRole;
  const tcmId = request.headers.get("x-tcm-id") ?? "tcm-3";
  return { role, tcmId };
}

export function resolveQueueScope(
  auth: OpsAuth,
  requestedTcmId: string | null,
): { filterTcmId?: string; error?: { status: number; message: string } } {
  if (auth.role === "flow-ops" || auth.role === "admin") {
    return { filterTcmId: requestedTcmId ?? undefined };
  }
  if (auth.role === "tcm") {
    if (requestedTcmId && requestedTcmId !== auth.tcmId) {
      return { error: { status: 403, message: "TCM cannot read another TCM's queue" } };
    }
    return { filterTcmId: auth.tcmId };
  }
  return { error: { status: 403, message: "Role not allowed for ops queue" } };
}
