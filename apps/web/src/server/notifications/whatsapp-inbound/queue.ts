import type { Kysely } from "kysely";

import type { WorkspaceDatabase } from "~/server/platform/database/types";
import { createJobQueue } from "~/server/platform/jobs/job-queue";
import type { QueueRunner } from "~/server/platform/jobs/types";

import { createWhatsAppInboundEventRepo } from "./inbound-event-repo";
import { processInboundWhatsAppEvent } from "./process-event";

export function createWhatsAppInboundQueue(
  db: Kysely<WorkspaceDatabase>,
): QueueRunner {
  return createJobQueue({
    name: "whatsapp-inbound-events",
    timeoutMs: 30_000,
    maxConcurrency: 8,
    store: createWhatsAppInboundEventRepo(db),
    handle: async (event, context) => {
      const { outcome } = await processInboundWhatsAppEvent(
        db,
        event,
        context.operationAt,
      );

      return {
        kind: "done",
        patch: {
          outcome,
        },
      };
    },
  });
}
