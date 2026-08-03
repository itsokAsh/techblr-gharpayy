import { createFileRoute } from "@tanstack/react-router";
import { parseOpsAuth } from "@/server/ops/auth";
import { getIdempotent, setIdempotent } from "@/server/ops/idempotency";
import { ingestLead, type IngestBody } from "@/server/ops/ingest";
import { clientIp } from "@/server/ops/phone";
import { checkRateLimit, INGEST_IP_LIMIT, INGEST_TCM_LIMIT } from "@/server/ops/rate-limit";

export const Route = createFileRoute("/api/ops/leads/ingest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = parseOpsAuth(request);
        const ip = clientIp(request);

        const tcmLimit = checkRateLimit({
          key: `ingest:tcm:${auth.tcmId}`,
          ...INGEST_TCM_LIMIT,
        });
        if (!tcmLimit.ok) {
          return Response.json(
            { error: "Rate limit exceeded for TCM", retryAfterSec: tcmLimit.retryAfterSec },
            { status: 429, headers: { "Retry-After": String(tcmLimit.retryAfterSec) } },
          );
        }

        const ipLimit = checkRateLimit({
          key: `ingest:ip:${ip}`,
          ...INGEST_IP_LIMIT,
        });
        if (!ipLimit.ok) {
          return Response.json(
            { error: "Rate limit exceeded for IP", retryAfterSec: ipLimit.retryAfterSec },
            { status: 429, headers: { "Retry-After": String(ipLimit.retryAfterSec) } },
          );
        }

        const idemKey = request.headers.get("idempotency-key")?.trim();
        if (idemKey) {
          const cached = getIdempotent(`ingest:${auth.tcmId}:${idemKey}`);
          if (cached) {
            return Response.json(cached.body, {
              status: cached.status,
              headers: { "X-Idempotent-Replay": "true" },
            });
          }
        }

        let body: IngestBody;
        try {
          body = (await request.json()) as IngestBody;
        } catch {
          return Response.json({ error: "Invalid JSON body" }, { status: 400 });
        }

        // Strip huge paste from being re-logged; ingest itself never logs raw phone
        const { httpStatus, result } = await ingestLead(auth, body);

        if (idemKey && result.status !== "error") {
          setIdempotent(`ingest:${auth.tcmId}:${idemKey}`, httpStatus, result);
        }

        return Response.json(result, {
          status: httpStatus,
          headers: { "Cache-Control": "no-store" },
        });
      },
    },
  },
});
