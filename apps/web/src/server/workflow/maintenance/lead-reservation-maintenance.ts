import type { WorkspaceExecutor } from "~/server/platform/database/executor";
import type { Duty } from "~/server/platform/schedule/schedule";
import { expireLapsedReservations } from "~/server/workflow/lead/commands/expire-reservation";
import { createLogger } from "~/shared/observability/runtime-logger";

import { createLeadRepo } from "../lead/write/lead-repo";

const logger = createLogger("lead-reservation-maintenance");

// Registration releases a lapsed reservation on its own; this duty keeps the
// lead lists from showing a hold that has already ended.
export function leadReservationDuty(executor: WorkspaceExecutor): Duty {
  return {
    name: "reservation-sweep",
    nextAt: () => createLeadRepo(executor).nextReservationLapseAt(),
    async run(context) {
      const expiredCount = await expireLapsedReservations(
        { executor },
        context.operationAt,
      );
      if (expiredCount > 0) {
        logger.info("lead_reservations_expired", { count: expiredCount });
      }
    },
  };
}
