import type {
  IngestJob,
  IngestJobDetail,
} from "~/contracts/data-sources/ingest";
import { JOB_KINDS, type JobEvent } from "~/contracts/jobs/job-event";
import type { DomainError } from "~/domain/errors";
import type { QueueState } from "~/domain/jobs/queue-state";
import { publishJobEvent } from "~/server/jobs/publish";
import type { WorkspaceExecutor } from "~/server/platform/database/executor";
import type { Duty } from "~/server/platform/schedule/schedule";
import type { RealtimePublisher } from "~/server/realtime/runtime";
import { createLogger } from "~/shared/observability/runtime-logger";
import { isErr, type Result } from "~/shared/result";

const POLL_INTERVAL_MS = 2_000;

// A job that has not settled by here is stuck; the watch ends rather than
// reading the engine forever.
const MAX_WATCH_MS = 30 * 60_000;

const logger = createLogger("ingest-watch");

function queueStateOf(job: IngestJob): QueueState {
  if (job.outcome === "succeeded") {
    return "done";
  }

  if (job.outcome === "failed") {
    return "failed";
  }

  return job.step === "queued" ? "pending" : "processing";
}

export function buildIngestJobEvent(job: IngestJob): JobEvent<IngestJobDetail> {
  return {
    kind: JOB_KINDS.dataSourceIngest,
    subjectId: job.job_id,
    state: queueStateOf(job),
    progress: {
      completed: job.accepted_rows ?? 0,
      failed: job.invalid_doc_rows ?? 0,
      total: job.total_rows ?? 0,
    },
    errorMessage: job.error,
    detail: {
      step: job.step,
      sourceKey: job.source_key,
      gate: job.gate,
    },
  };
}

const later = (at: Date, ms: number) => new Date(at.getTime() + ms);

/**
 * Republishes engine ingest jobs onto the job channel. The server follows a
 * job, not each open tab, and the follow is a row, so it survives the object
 * being evicted and keeps nothing awake between reads.
 */
export function createIngestWatch(deps: {
  db: WorkspaceExecutor;
  realtime: RealtimePublisher;
  getJob: (jobId: string) => Promise<Result<IngestJob, DomainError>>;
}) {
  const { db } = deps;

  // Whether the job still runs. A failed read counts as running, so a blip in
  // the engine retries until the watch ends.
  async function stillRunning(jobId: string): Promise<boolean> {
    const result = await deps.getJob(jobId);
    if (isErr(result)) {
      logger.warn("ingest_job_read_failed", { jobId, error: result.error });
      return true;
    }
    publishJobEvent(deps.realtime, db, buildIngestJobEvent(result.value));
    return result.value.outcome === "running";
  }

  const duty: Duty = {
    name: "ingest-watch",
    spacingMs: POLL_INTERVAL_MS,
    async nextAt() {
      const row = await db
        .selectFrom("ingest_watches")
        .select("poll_at")
        .orderBy("poll_at")
        .limit(1)
        .executeTakeFirst();
      return row?.poll_at ?? null;
    },
    async run({ operationAt: at }) {
      const due = await db
        .selectFrom("ingest_watches")
        .selectAll()
        .where("poll_at", "<=", at)
        .execute();
      for (const watch of due) {
        // Sequential: a firing reads few jobs, and in parallel they would
        // only press the engine harder.
        const expired = watch.watch_until <= at;
        if (expired) {
          logger.warn("ingest_job_watch_expired", { jobId: watch.job_id });
        }
        // eslint-disable-next-line no-await-in-loop
        if (!expired && (await stillRunning(watch.job_id))) {
          // eslint-disable-next-line no-await-in-loop
          await db
            .updateTable("ingest_watches")
            .set({ poll_at: later(at, POLL_INTERVAL_MS) })
            .where("job_id", "=", watch.job_id)
            .execute();
        } else {
          // eslint-disable-next-line no-await-in-loop
          await db
            .deleteFrom("ingest_watches")
            .where("job_id", "=", watch.job_id)
            .execute();
        }
      }
    },
  };

  // Idempotent: a job already followed keeps its watch.
  async function track(jobId: string, at: Date): Promise<void> {
    await db
      .insertInto("ingest_watches")
      .values({
        job_id: jobId,
        poll_at: at,
        watch_until: later(at, MAX_WATCH_MS),
      })
      .onConflict((oc) => oc.column("job_id").doNothing())
      .execute();
  }

  return { duty, track };
}
