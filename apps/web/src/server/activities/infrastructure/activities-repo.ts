import type { Kysely } from "kysely";

import type {
  ActivityId,
  ActivityOutcomeId,
  BranchId,
  OrganizationId,
  UserId,
} from "~/domain/ids";
import type {
  ActivityChannel,
  ActivitySource,
  Database,
} from "~/server/platform/database/types";

import {
  subjectColumns,
  type ActivitySubject,
} from "../domain/activity-subject";

export type NewActivity = {
  channel: ActivityChannel;
  userId: UserId;
  branchId: BranchId;
  organizationId: OrganizationId;
  subject: ActivitySubject | null;
  phone: string | null;
  source: ActivitySource;
  startedAt: Date;
  endedAt?: Date | null;
  outcomeId?: ActivityOutcomeId | null;
  notes?: string | null;
};

// The single writer of `activities`. Every update is scoped to the caller's
// own activity, so one user cannot close or annotate another user's work.
export function createActivitiesRepo(db: Kysely<Database>) {
  return {
    async create(activity: NewActivity): Promise<ActivityId> {
      const row = await db
        .insertInto("activities")
        .values({
          channel: activity.channel,
          user_id: activity.userId,
          branch_id: activity.branchId,
          organization_id: activity.organizationId,
          ...subjectColumns(activity.subject),
          phone: activity.phone,
          source: activity.source,
          started_at: activity.startedAt,
          ended_at: activity.endedAt ?? null,
          outcome_id: activity.outcomeId ?? null,
          notes: activity.notes ?? null,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      return row.id;
    },

    // Sets the end once; a later end report leaves the first one in place.
    async end(activityId: ActivityId, endedAt: Date): Promise<void> {
      await db
        .updateTable("activities")
        .set({ ended_at: endedAt })
        .where("id", "=", activityId)
        .where("ended_at", "is", null)
        .execute();
    },

    // The same first end, from the user's own client.
    async endOwn(input: {
      activityId: ActivityId;
      userId: UserId;
      endedAt: Date;
    }): Promise<void> {
      await db
        .updateTable("activities")
        .set({ ended_at: input.endedAt })
        .where("id", "=", input.activityId)
        .where("user_id", "=", input.userId)
        .where("ended_at", "is", null)
        .execute();
    },

    async recordResult(input: {
      activityId: ActivityId;
      userId: UserId;
      endedAt: Date;
      outcomeId: ActivityOutcomeId;
      notes: string | null;
    }): Promise<void> {
      await db
        .updateTable("activities")
        .set((eb) => ({
          ended_at: eb.fn.coalesce("ended_at", eb.val(input.endedAt)),
          outcome_id: input.outcomeId,
          notes: input.notes,
        }))
        .where("id", "=", input.activityId)
        .where("user_id", "=", input.userId)
        .execute();
    },

    async recordDuration(input: {
      activityId: ActivityId;
      userId: UserId;
      durationSeconds: number;
    }): Promise<void> {
      await db
        .updateTable("activities")
        .set({ duration_seconds: input.durationSeconds })
        .where("id", "=", input.activityId)
        .where("user_id", "=", input.userId)
        .execute();
    },

    // The user's latest activity of this channel on the subject since a
    // moment, such as the call the extension logged while a record was held.
    async findLatestOnSubject(input: {
      userId: UserId;
      subject: ActivitySubject;
      channel: ActivityChannel;
      since: Date;
    }): Promise<ActivityId | null> {
      const { subject } = input;
      const row = await db
        .selectFrom("activities")
        .select("id")
        .where("user_id", "=", input.userId)
        .where("channel", "=", input.channel)
        .where("started_at", ">=", input.since)
        .where((eb) => {
          switch (subject.kind) {
            case "contact":
              return eb("contact_id", "=", subject.contactId);
            case "campaign_record":
              return eb("campaign_record_id", "=", subject.campaignRecordId);
            case "case":
              return eb("case_id", "=", subject.caseId);
          }
        })
        .orderBy("started_at", "desc")
        .limit(1)
        .executeTakeFirst();
      return row?.id ?? null;
    },
  };
}

export type ActivitiesRepo = ReturnType<typeof createActivitiesRepo>;
