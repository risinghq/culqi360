import { sql, type Transaction } from "kysely";

import { fail, type DomainError } from "~/domain/errors";
import type { UserId, WorkflowLeadId } from "~/domain/ids";
import { createEventsWriter } from "~/server/event-logs/events-repo";
import { assignOrganizationOwnerInTransaction } from "~/server/organization/ownership";
import type { WorkspaceDatabase } from "~/server/platform/database/types";
import type { LeadHistoryEventDraft } from "~/server/workflow/lead/domain/history";
import type { LeadState } from "~/server/workflow/lead/domain/state";
import { Err, Ok, type Result } from "~/shared/result";

import { toLeadEventAppend } from "./lead-events";

export type LeadTransition = {
  next: LeadState;
  events: LeadHistoryEventDraft[];
};

export type LeadAssignment = {
  toExecutiveId: UserId;
  assignedBy: UserId;
  assignedAt: Date;
};

export async function commitTransition(
  tx: Transaction<WorkspaceDatabase>,
  transition: LeadTransition,
  assignment?: LeadAssignment,
): Promise<Result<{ eventIds: string[] }, DomainError>> {
  const { next, events } = transition;

  const updateResult = await tx
    .updateTable("workflow_leads")
    .set({
      stage: next.stage,
      status: next.status,
      priority: next.priority,
      updated_by: next.updatedBy,
      updated_at: next.updatedAt,
      reservation_expires_at: next.reservationExpiresAt,
      deleted_at: next.deletedAt,
      version: next.version,
    })
    .where("id", "=", next.id)
    .where("version", "=", next.version - 1)
    .executeTakeFirst();

  if (Number(updateResult.numUpdatedRows) === 0) {
    return Err(fail("concurrency_conflict"));
  }

  if (assignment) {
    const assigned = await assignOrganizationOwnerInTransaction(tx, {
      organizationId: next.organizationId,
      executiveId: assignment.toExecutiveId,
      assignedBy: assignment.assignedBy,
      assignedAt: assignment.assignedAt,
      reason: "workflow_reassignment",
    });

    if (!assigned.ok) {
      return assigned;
    }
  }

  const eventIds = await createEventsWriter(tx).append(
    events.map(toLeadEventAppend),
  );

  return Ok({ eventIds });
}

export type LeadChange = { fromVersion: number; next: LeadState };

/** Writes many leads' transitions in one statement, then their events. Each
 * lead moves from the version it was read at, which may lie several
 * transitions back. */
export async function commitLeadChanges(
  tx: Transaction<WorkspaceDatabase>,
  changes: readonly LeadChange[],
  events: readonly LeadHistoryEventDraft[],
): Promise<Result<{ eventIds: string[] }, DomainError>> {
  if (changes.length > 0) {
    const leads = JSON.stringify(
      changes.map(({ fromVersion, next }) => ({
        id: next.id,
        from_version: fromVersion,
        stage: next.stage,
        status: next.status,
        priority: next.priority,
        updated_by: next.updatedBy,
        updated_at: next.updatedAt,
        reservation_expires_at: next.reservationExpiresAt,
        deleted_at: next.deletedAt,
        version: next.version,
      })),
    );
    const updated = await tx
      .updateTable("workflow_leads")
      .from(sql`json_each(${leads})`.as("change"))
      .set({
        stage: sql`change.value ->> 'stage'`,
        status: sql`change.value ->> 'status'`,
        priority: sql`change.value ->> 'priority'`,
        updated_by: sql`change.value ->> 'updated_by'`,
        updated_at: sql`change.value ->> 'updated_at'`,
        reservation_expires_at: sql`change.value ->> 'reservation_expires_at'`,
        deleted_at: sql`change.value ->> 'deleted_at'`,
        version: sql`change.value ->> 'version'`,
      })
      .where(
        "workflow_leads.id",
        "=",
        sql<WorkflowLeadId>`change.value ->> 'id'`,
      )
      .where(
        "workflow_leads.version",
        "=",
        sql<number>`change.value ->> 'from_version'`,
      )
      .executeTakeFirst();

    if (Number(updated.numUpdatedRows) !== changes.length) {
      return Err(fail("concurrency_conflict"));
    }
  }

  const eventIds = await createEventsWriter(tx).append(
    events.map(toLeadEventAppend),
  );

  return Ok({ eventIds });
}

export async function appendFacts(
  tx: Transaction<WorkspaceDatabase>,
  operationAt: Date,
  events: LeadHistoryEventDraft[],
): Promise<Result<{ eventIds: string[] }, DomainError>> {
  const [firstEvent] = events;

  if (!firstEvent) {
    return Ok({ eventIds: [] });
  }

  const leadId = firstEvent.leadId;

  const updateResult = await tx
    .updateTable("workflow_leads")
    .set({
      updated_at: operationAt,
      updated_by: firstEvent.actorUserId,
    })
    .where("id", "=", leadId)
    .where("deleted_at", "is", null)
    .executeTakeFirst();

  if (Number(updateResult.numUpdatedRows) === 0) {
    return Err(fail("lead_not_found"));
  }

  const eventIds = await createEventsWriter(tx).append(
    events.map(toLeadEventAppend),
  );

  return Ok({ eventIds });
}
