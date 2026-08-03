import { createFileRoute } from "@tanstack/react-router";
import { getCacheVersion } from "@/server/ops/store";
import type { OpsHealthResponse } from "@/server/ops/types";

export const Route = createFileRoute("/api/ops/health")({
  server: {
    handlers: {
      GET: async () => {
        const body: OpsHealthResponse = {
          ok: true,
          service: "gharpayy-ops",
          cacheVersion: getCacheVersion(),
          serverNow: Date.now(),
        };
        return Response.json(body, {
          headers: { "Cache-Control": "no-store" },
        });
      },
    },
  },
});
