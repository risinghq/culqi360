import type { Kysely } from "kysely";

import type { WorkspaceDatabase } from "~/server/platform/database/types";
import {
  createJobStore,
  type JobStore,
} from "~/server/platform/jobs/job-store";

export type OutboundWhatsAppMessageJob = {
  id: string;
  attempt_count: number;
  max_attempts: number;
  recipient_address: string;
  body_text: string;
};

export function createOutboundWhatsAppMessageRepo(
  db: Kysely<WorkspaceDatabase>,
): JobStore<string, OutboundWhatsAppMessageJob> {
  return createJobStore<OutboundWhatsAppMessageJob, string>(
    db,
    "outbound_whatsapp_messages",
    ["id", "attempt_count", "max_attempts", "recipient_address", "body_text"],
  );
}
