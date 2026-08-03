import { createFileRoute } from "@tanstack/react-router";
import { parseOpsAuth, resolveQueueScope } from "@/server/ops/auth";
import { getTodayQueue } from "@/server/ops/queue";

export const Route = createFileRoute("/api/ops/today/queue")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const requestedTcmId = url.searchParams.get("tcmId");
        const auth = parseOpsAuth(request);
        const scope = resolveQueueScope(auth, requestedTcmId);

        if (scope.error) {
          return Response.json(
            { error: scope.error.message },
            { status: scope.error.status },
          );
        }

        const { body, cache } = await getTodayQueue(scope.filterTcmId);
        return Response.json(body, {
          headers: {
            "Cache-Control": "private, max-age=15",
            "X-Cache": cache,
            "X-Server-Now": String(body.serverNow),
          },
        });
      },
    },
  },
});
