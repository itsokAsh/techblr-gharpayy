import { createFileRoute } from "@tanstack/react-router";
import { parseOpsAuth } from "@/server/ops/auth";
import { getJobQueue, getQueueStats, processQueue, retryJob } from "@/server/ops/worker";

export const Route = createFileRoute("/api/ops/jobs")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = parseOpsAuth(request);
        if (auth.role !== "flow-ops" && auth.role !== "admin" && auth.role !== "tcm") {
          return Response.json({ error: "Forbidden" }, { status: 403 });
        }
        const jobs = getJobQueue();
        const stats = getQueueStats();
        return Response.json(
          { jobs, stats },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
      POST: async ({ request }) => {
        const auth = parseOpsAuth(request);
        if (auth.role !== "flow-ops" && auth.role !== "admin" && auth.role !== "tcm") {
          return Response.json({ error: "Forbidden" }, { status: 403 });
        }

        let body: { action?: "tick" | "retry"; jobId?: string };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          body = { action: "tick" };
        }

        if (body.action === "retry" && body.jobId) {
          const ok = retryJob(body.jobId);
          if (!ok) return Response.json({ error: "Job not found" }, { status: 404 });
          const tickRes = await processQueue();
          return Response.json({ status: "retried", jobId: body.jobId, ...tickRes });
        }

        // Default: worker tick
        const tickRes = await processQueue();
        return Response.json({ status: "ticked", ...tickRes });
      },
    },
  },
});
