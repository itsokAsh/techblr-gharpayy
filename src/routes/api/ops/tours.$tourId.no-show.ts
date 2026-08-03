import { createFileRoute } from "@tanstack/react-router";
import type { NoShowReason } from "@/lib/types";
import { parseOpsAuth } from "@/server/ops/auth";
import { getIdempotent, setIdempotent } from "@/server/ops/idempotency";
import { markOpsTourNoShow } from "@/server/ops/tour-actions";

export const Route = createFileRoute("/api/ops/tours/$tourId/no-show")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const auth = parseOpsAuth(request);
        const tourId = params.tourId;

        const idemKey = request.headers.get("idempotency-key")?.trim();
        if (idemKey) {
          const cached = getIdempotent(`no-show:${auth.tcmId}:${tourId}:${idemKey}`);
          if (cached) {
            return Response.json(cached.body, {
              status: cached.status,
              headers: { "X-Idempotent-Replay": "true" },
            });
          }
        }

        let body: { reason?: NoShowReason };
        try {
          body = (await request.json()) as { reason?: NoShowReason };
        } catch {
          return Response.json({ error: "Invalid JSON body" }, { status: 400 });
        }

        const reason = body.reason ?? "didnt-answer";
        const { httpStatus, result } = markOpsTourNoShow(auth, tourId, reason);
        if (idemKey && result.status === "logged") {
          setIdempotent(`no-show:${auth.tcmId}:${tourId}:${idemKey}`, httpStatus, result);
        }

        return Response.json(result, {
          status: httpStatus,
          headers: {
            "Cache-Control": "no-store",
            ...(result.status === "logged" ? { "X-Server-Now": String(result.serverNow) } : {}),
          },
        });
      },
    },
  },
});
