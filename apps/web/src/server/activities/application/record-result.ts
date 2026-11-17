import { fail, type DomainError } from "~/domain/errors";
import type {
  ActivityId,
  ActivityOutcomeId,
  BranchId,
  OrganizationId,
  UserId,
} from "~/domain/ids";
import { Err, Ok, type Result } from "~/shared/result";

import type { ActivitySubject } from "../domain/activity-subject";
import type { ActivitiesRepo } from "../infrastructure/activities-repo";
import type { OutcomesRepo } from "../infrastructure/outcomes-repo";

export type RecordResultInput = {
  actorUserId: UserId;
  branchId: BranchId;
  organizationId: OrganizationId;
  subject: ActivitySubject;
  // The number dialed when the work was a call; ignored on a visit.
  phone: string | null;
  // The result lands on the user's own activity on the subject since then.
  since: Date;
  at: Date;
  outcomeId: ActivityOutcomeId;
  notes: string | null;
};

export type RecordResultRepos = {
  activities: Pick<
    ActivitiesRepo,
    "create" | "findLatestOnSubject" | "recordResult"
  >;
  outcomes: Pick<OutcomesRepo, "findLive">;
};

// Records the user's result on a subject they worked. The outcome's channel
// says whether it was a call or a visit. The result lands on the activity
// already logged for that work, such as the extension's call; without one,
// the result is the record of the activity. Run it inside the caller's
// transaction.
export async function recordResult(
  input: RecordResultInput,
  repos: RecordResultRepos,
): Promise<Result<ActivityId, DomainError>> {
  const outcome = await repos.outcomes.findLive(input.outcomeId);
  if (!outcome) {
    return Err(fail("activity_outcome_not_found"));
  }

  const existing = await repos.activities.findLatestOnSubject({
    userId: input.actorUserId,
    subject: input.subject,
    channel: outcome.channel,
    since: input.since,
  });
  if (existing !== null) {
    await repos.activities.recordResult({
      activityId: existing,
      userId: input.actorUserId,
      endedAt: input.at,
      outcomeId: outcome.id,
      notes: input.notes,
    });
    return Ok(existing);
  }

  const created = await repos.activities.create({
    channel: outcome.channel,
    userId: input.actorUserId,
    branchId: input.branchId,
    organizationId: input.organizationId,
    subject: input.subject,
    phone: outcome.channel === "call" ? input.phone : null,
    source: "manual",
    startedAt: input.at,
    endedAt: input.at,
    outcomeId: outcome.id,
    notes: input.notes,
  });
  return Ok(created);
}
