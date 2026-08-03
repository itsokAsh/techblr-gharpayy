import { createFileRoute } from "@tanstack/react-router";
import { parseOpsAuth } from "@/server/ops/auth";
import { getIdempotent, setIdempotent } from "@/server/ops/idempotency";
import { saveOpsPreTourCheck, type PreCheckBody } from "@/server/ops/tour-actions";

export const Route = createFileRoute("/api/ops/tours/$tourId/pre-check")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const auth = parseOpsAuth(request);
        const tourId = params.tourId;

        const idemKey = request.headers.get("idempotency-key")?.trim();
        if (idemKey) {
          const cached = getIdempotent(`pre-check:${auth.tcmId}:${tourId}:${idemKey}`);
          if (cached) {
            return Response.json(cached.body, {
              status: cached.status,
              headers: { "X-Idempotent-Replay": "true" },
            });
          }
        }

        let body: PreCheckBody;
        try {
          body = (await request.json()) as PreCheckBody;
        } catch {
          return Response.json({ error: "Invalid JSON body" }, { status: 400 });
        }

        const { httpStatus, result } = saveOpsPreTourCheck(auth, tourId, body);
        if (idemKey && result.status === "saved") {
          setIdempotent(`pre-check:${auth.tcmId}:${tourId}:${idemKey}`, httpStatus, result);
        }

        return Response.json(result, {
          status: httpStatus,
          headers: {
            "Cache-Control": "no-store",
            ...(result.status === "saved" ? { "X-Server-Now": String(result.serverNow) } : {}),
          },
        });
      },
    },
  },
});
