import { createFileRoute } from "@tanstack/react-router";
import { parseOpsAuth } from "@/server/ops/auth";
import { bumpCacheVersion } from "@/server/ops/store";

/** Dev/admin: bump cache version so all queue keys miss. */
export const Route = createFileRoute("/api/ops/cache/invalidate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = parseOpsAuth(request);
        if (auth.role !== "flow-ops" && auth.role !== "admin") {
          return Response.json({ error: "Forbidden" }, { status: 403 });
        }
        const version = bumpCacheVersion();
        return Response.json({ ok: true, cacheVersion: version, serverNow: Date.now() });
      },
    },
  },
});
