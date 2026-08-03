import { getOpsSnapshot, updateOpsLead, uid } from "./store";

export type JobKind = "no-show-call" | "no-show-reschedule";
export type JobStatus = "pending" | "processing" | "completed" | "failed";

export interface QueueJob {
  id: string;
  kind: JobKind;
  tourId: string;
  leadId: string;
  tcmId: string;
  runAt: string; // ISO string
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  lastError?: string;
  executedAt?: string;
  createdAt: string;
}

let jobQueue: QueueJob[] = [];

export function getJobQueue(): QueueJob[] {
  return [...jobQueue];
}

export function enqueueJob(opts: {
  kind: JobKind;
  tourId: string;
  leadId: string;
  tcmId: string;
  runAt: string;
  maxAttempts?: number;
}): QueueJob {
  const job: QueueJob = {
    id: uid("job"),
    kind: opts.kind,
    tourId: opts.tourId,
    leadId: opts.leadId,
    tcmId: opts.tcmId,
    runAt: opts.runAt,
    status: "pending",
    attempts: 0,
    maxAttempts: opts.maxAttempts ?? 3,
    createdAt: new Date().toISOString(),
  };
  jobQueue.push(job);
  console.info("[ops:worker] Enqueued job", { jobId: job.id, kind: job.kind, runAt: job.runAt });
  return job;
}

export function retryJob(jobId: string): boolean {
  const job = jobQueue.find((j) => j.id === jobId);
  if (!job) return false;
  job.status = "pending";
  job.runAt = new Date().toISOString(); // run now
  job.attempts = 0;
  job.lastError = undefined;
  return true;
}

export interface QueueSummary {
  total: number;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  serverNow: number;
}

export function getQueueStats(now = Date.now()): QueueSummary {
  return {
    total: jobQueue.length,
    pending: jobQueue.filter((j) => j.status === "pending").length,
    processing: jobQueue.filter((j) => j.status === "processing").length,
    completed: jobQueue.filter((j) => j.status === "completed").length,
    failed: jobQueue.filter((j) => j.status === "failed").length,
    serverNow: now,
  };
}

/**
 * Worker tick: Processes pending jobs whose runAt <= now.
 * Implements execution handlers and exponential backoff retry.
 */
export async function processQueue(now = Date.now()): Promise<{
  processedCount: number;
  executedJobs: QueueJob[];
  stats: QueueSummary;
}> {
  const dueJobs = jobQueue.filter((j) => j.status === "pending" && new Date(j.runAt).getTime() <= now);
  const executedJobs: QueueJob[] = [];

  for (const job of dueJobs) {
    job.status = "processing";
    job.attempts += 1;

    try {
      await executeJob(job, now);
      job.status = "completed";
      job.executedAt = new Date(now).toISOString();
      executedJobs.push({ ...job });
      console.info("[ops:worker] Job completed", { jobId: job.id, kind: job.kind });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      job.lastError = errMsg;

      if (job.attempts >= job.maxAttempts) {
        job.status = "failed";
        console.warn("[ops:worker] Job failed (max attempts reached)", { jobId: job.id, attempts: job.attempts, err: errMsg });
      } else {
        job.status = "pending";
        // Exponential backoff: 2^attempts minutes
        const backoffMs = Math.pow(2, job.attempts) * 60_000;
        job.runAt = new Date(now + backoffMs).toISOString();
        console.info("[ops:worker] Job rescheduled after error", { jobId: job.id, nextRunAt: job.runAt, attempt: job.attempts });
      }
      executedJobs.push({ ...job });
    }
  }

  return {
    processedCount: executedJobs.length,
    executedJobs,
    stats: getQueueStats(now),
  };
}

/** Job execution handlers */
async function executeJob(job: QueueJob, now: number): Promise<void> {
  const snap = getOpsSnapshot();
  const lead = snap.leads.find((l) => l.id === job.leadId);
  const tour = snap.tours.find((t) => t.id === job.tourId);

  if (!lead || !tour) {
    throw new Error(`Invalid lead (${job.leadId}) or tour (${job.tourId})`);
  }

  if (job.kind === "no-show-call") {
    // 30m rescue call job — ensure tag/state updated
    updateOpsLead(lead.id, {
      tags: Array.from(new Set([...lead.tags, "no-show-call-due"])),
      updatedAt: new Date(now).toISOString(),
    });
  } else if (job.kind === "no-show-reschedule") {
    // 24h reschedule job — auto-tag lead & trigger reschedule sequence
    if (lead.stage !== "booked") {
      updateOpsLead(lead.id, {
        tags: Array.from(new Set([...lead.tags, "no-show-reschedule-sent"])),
        updatedAt: new Date(now).toISOString(),
      });
    }
  }
}
