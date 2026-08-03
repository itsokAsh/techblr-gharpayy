import { createFileRoute } from "@tanstack/react-router";
import { parseOpsAuth } from "@/server/ops/auth";
import { getIdempotent, setIdempotent } from "@/server/ops/idempotency";
import { updateOpsVacancy } from "@/server/ops/vacancy";

export const Route = createFileRoute("/api/ops/properties/$propertyId/vacancy")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const auth = parseOpsAuth(request);
        const propertyId = params.propertyId;

        const idemKey = request.headers.get("idempotency-key")?.trim();
        if (idemKey) {
          const cached = getIdempotent(`vacancy:${auth.tcmId}:${propertyId}:${idemKey}`);
          if (cached) {
            return Response.json(cached.body, {
              status: cached.status,
              headers: { "X-Idempotent-Replay": "true" },
            });
          }
        }

        let body: { expectedVersion?: number; vacantBeds?: number; nextVacancyAt?: string | null };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return Response.json({ error: "Invalid JSON body" }, { status: 400 });
        }

        const { httpStatus, result } = updateOpsVacancy(auth, propertyId, {
          expectedVersion: Number(body.expectedVersion),
          vacantBeds: Number(body.vacantBeds),
          nextVacancyAt: body.nextVacancyAt,
        });

        if (idemKey && result.status === "updated") {
          setIdempotent(`vacancy:${auth.tcmId}:${propertyId}:${idemKey}`, httpStatus, result);
        }

        return Response.json(result, {
          status: httpStatus,
          headers: {
            "Cache-Control": "no-store",
            ...(result.status === "updated" ? { "X-Server-Now": String(result.serverNow) } : {}),
          },
        });
      },
    },
  },
});
