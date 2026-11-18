import type { ActivityChannelKey } from "~/domain/activities/channel";
import { fail, type DomainError } from "~/domain/errors";
import type { ActivityOutcomeId, UserId } from "~/domain/ids";
import { activityRangeProblem } from "~/domain/reports/activity-range";
import { appDayRange, appInstantAt } from "~/domain/time/app-time";
import type { CalendarDate } from "~/domain/time/calendar-date";
import { Err, Ok, type Result } from "~/shared/result";

import type {
  ActivityRow,
  ReportReach,
  ReportsRepo,
} from "../infrastructure/reports-repo";

export type ActivityQuery = {
  from: CalendarDate;
  to: CalendarDate;
  reach: ReportReach;
  userId: UserId | null;
  channel: ActivityChannelKey | null;
  outcomeId: ActivityOutcomeId | null;
};

// `to` is inclusive: the range ends where the next app day starts.
export async function listReportActivities(
  repo: Pick<ReportsRepo, "listActivities">,
  query: ActivityQuery,
  limit: number | null,
): Promise<Result<ActivityRow[], DomainError>> {
  if (activityRangeProblem(query.from, query.to) !== null) {
    return Err(fail("report_range_invalid"));
  }
  const rows = await repo.listActivities({
    range: {
      start: appInstantAt(query.from),
      endExclusive: appDayRange(query.to).endExclusive,
    },
    reach: query.reach,
    userId: query.userId,
    channel: query.channel,
    outcomeId: query.outcomeId,
    limit,
  });
  return Ok(rows);
}
