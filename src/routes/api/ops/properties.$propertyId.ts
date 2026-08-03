import { createFileRoute } from "@tanstack/react-router";
import { parseOpsAuth } from "@/server/ops/auth";
import { getOpsVacancy } from "@/server/ops/vacancy";

export const Route = createFileRoute("/api/ops/properties/$propertyId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        parseOpsAuth(request);
        const snap = getOpsVacancy(params.propertyId);
        if (!snap) {
          return Response.json({ error: "Property not found" }, { status: 404 });
        }
        return Response.json(snap, {
          headers: {
            "Cache-Control": "no-store",
            "X-Server-Now": String(snap.serverNow),
          },
        });
      },
    },
  },
});
