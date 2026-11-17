import type { ActionSuccess } from "~/contracts/common";
import { fail, type DomainError } from "~/domain/errors";
import { normalizePhone } from "~/server/calls/domain/call-target";
import type { CallsRepo } from "~/server/calls/infrastructure/calls-repo";
import type { ContactAssignmentsRepo } from "~/server/contact-assignments/infrastructure/assignment-repo";
import type { OrganizationRepository } from "~/server/organization/organization-repo";
import type { AppUow } from "~/server/platform/database/uow";
import type { OperationContext } from "~/server/platform/operation/context";
import { Err, Ok, type Result } from "~/shared/result";

import type { CompleteContactAssignmentCallCommand } from "./contracts";

type CompleteContactAssignmentCallTxRepos = {
  contactAssignments: Pick<
    ContactAssignmentsRepo,
    "findActiveByIdForUser" | "markCompleted"
  >;
  organization: Pick<OrganizationRepository, "findMembershipById">;
  calls: Pick<CallsRepo, "create" | "findLatestOnContact" | "recordResult">;
};

async function completeAssignmentCall(
  input: CompleteContactAssignmentCallCommand,
  repos: CompleteContactAssignmentCallTxRepos,
  operation: OperationContext,
): Promise<Result<ActionSuccess, DomainError>> {
  const at = operation.operationAt;
  const assignment = await repos.contactAssignments.findActiveByIdForUser(
    input.assignmentId,
    input.actorUserId,
    at,
  );
  if (!assignment || assignment.contact_id !== input.contactId) {
    return Err(fail("assignment_inactive"));
  }
  const member = await repos.organization.findMembershipById(input.contactId);
  if (!member) {
    return Err(fail("assignment_inactive"));
  }

  await repos.contactAssignments.markCompleted(
    input.assignmentId,
    input.actorUserId,
  );

  // The outcome lands on the call the extension already logged for this
  // assignment. Without one, the completion is the record of the call.
  const existing = await repos.calls.findLatestOnContact({
    userId: input.actorUserId,
    contactId: member.id,
    since: assignment.assigned_at,
  });
  if (existing === null) {
    await repos.calls.create({
      userId: input.actorUserId,
      branchId: input.branchId,
      organizationId: member.organizationId,
      subject: { kind: "contact", contactId: member.id },
      phone: normalizePhone(member.phone ?? ""),
      source: "manual",
      startedAt: at,
      endedAt: at,
      outcome: input.outcome,
      notes: input.notes,
    });
  } else {
    await repos.calls.recordResult({
      callId: existing,
      userId: input.actorUserId,
      endedAt: at,
      outcome: input.outcome,
      notes: input.notes,
    });
  }

  return Ok({ success: true });
}

export function completeContactAssignmentCall(
  input: CompleteContactAssignmentCallCommand,
  uow: AppUow<CompleteContactAssignmentCallTxRepos>,
  operation: OperationContext,
): Promise<Result<ActionSuccess, DomainError>> {
  return uow.run((repos) => completeAssignmentCall(input, repos, operation));
}
