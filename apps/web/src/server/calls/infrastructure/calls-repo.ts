import type { Kysely } from "kysely";

import type {
  BranchId,
  CallId,
  OrganizationId,
  OrganizationPersonId,
  UserId,
} from "~/domain/ids";
import type { CallSubject } from "~/server/calls/domain/call-target";
import type { CallSource, Database } from "~/server/platform/database/types";

export type NewCall = {
  userId: UserId;
  branchId: BranchId;
  organizationId: OrganizationId;
  subject: CallSubject | null;
  phone: string | null;
  source: CallSource;
  startedAt: Date;
  endedAt?: Date | null;
  outcome?: string | null;
  notes?: string | null;
};

// The three subject columns shared by `calls` and `extension_handoffs`.
export function subjectColumns(subject: CallSubject | null) {
  return {
    campaign_record_id:
      subject?.kind === "campaign_record" ? subject.campaignRecordId : null,
    case_id: subject?.kind === "case" ? subject.caseId : null,
    organization_person_id:
      subject?.kind === "person" ? subject.organizationPersonId : null,
  };
}

// The single writer of `calls`. Every update is scoped to the caller's own
// call, so one user cannot close or annotate another user's call.
export function createCallsRepo(db: Kysely<Database>) {
  return {
    async create(call: NewCall): Promise<CallId> {
      const row = await db
        .insertInto("calls")
        .values({
          user_id: call.userId,
          branch_id: call.branchId,
          organization_id: call.organizationId,
          ...subjectColumns(call.subject),
          phone: call.phone,
          source: call.source,
          started_at: call.startedAt,
          ended_at: call.endedAt ?? null,
          outcome: call.outcome ?? null,
          notes: call.notes ?? null,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      return row.id;
    },

    // Sets the end once; a later end report leaves the first one in place.
    async end(callId: CallId, endedAt: Date): Promise<void> {
      await db
        .updateTable("calls")
        .set({ ended_at: endedAt })
        .where("id", "=", callId)
        .where("ended_at", "is", null)
        .execute();
    },

    async recordResult(input: {
      callId: CallId;
      userId: UserId;
      endedAt: Date;
      outcome: string | null;
      notes: string | null;
    }): Promise<void> {
      await db
        .updateTable("calls")
        .set((eb) => ({
          ended_at: eb.fn.coalesce("ended_at", eb.val(input.endedAt)),
          outcome: input.outcome,
          notes: input.notes,
        }))
        .where("id", "=", input.callId)
        .where("user_id", "=", input.userId)
        .execute();
    },

    async recordDuration(input: {
      callId: CallId;
      userId: UserId;
      durationSeconds: number;
    }): Promise<void> {
      await db
        .updateTable("calls")
        .set({ duration_seconds: input.durationSeconds })
        .where("id", "=", input.callId)
        .where("user_id", "=", input.userId)
        .execute();
    },

    async findLatestOnPerson(input: {
      userId: UserId;
      organizationPersonId: OrganizationPersonId;
      since: Date;
    }): Promise<CallId | null> {
      const row = await db
        .selectFrom("calls")
        .select("id")
        .where("user_id", "=", input.userId)
        .where("organization_person_id", "=", input.organizationPersonId)
        .where("started_at", ">=", input.since)
        .orderBy("started_at", "desc")
        .limit(1)
        .executeTakeFirst();
      return row?.id ?? null;
    },
  };
}

export type CallsRepo = ReturnType<typeof createCallsRepo>;
