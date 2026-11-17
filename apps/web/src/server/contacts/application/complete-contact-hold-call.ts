import type { ActionSuccess } from "~/contracts/common";
import { fail, type DomainError } from "~/domain/errors";
import { normalizePhone } from "~/server/calls/domain/call-target";
import type { CallsRepo } from "~/server/calls/infrastructure/calls-repo";
import type { ContactHoldsRepo } from "~/server/contacts/infrastructure/hold-repo";
import type { OrganizationRepository } from "~/server/organization/organization-repo";
import type { AppUow } from "~/server/platform/database/uow";
import type { OperationContext } from "~/server/platform/operation/context";
import { Err, Ok, type Result } from "~/shared/result";

import type { CompleteContactHoldCallCommand } from "./contracts";

type CompleteContactHoldCallTxRepos = {
  contactHolds: Pick<
    ContactHoldsRepo,
    "findActiveByIdForUser" | "markCompleted"
  >;
  organization: Pick<OrganizationRepository, "findMembershipById">;
  calls: Pick<CallsRepo, "create" | "findLatestOnContact" | "recordResult">;
};

async function completeHoldCall(
  input: CompleteContactHoldCallCommand,
  repos: CompleteContactHoldCallTxRepos,
  operation: OperationContext,
): Promise<Result<ActionSuccess, DomainError>> {
  const at = operation.operationAt;
  const hold = await repos.contactHolds.findActiveByIdForUser(
    input.holdId,
    input.actorUserId,
    at,
  );
  if (!hold || hold.contact_id !== input.contactId) {
    return Err(fail("contact_hold_inactive"));
  }
  const member = await repos.organization.findMembershipById(input.contactId);
  if (!member) {
    return Err(fail("contact_hold_inactive"));
  }

  await repos.contactHolds.markCompleted(input.holdId, input.actorUserId);

  // The outcome lands on the call the extension already logged for this
  // hold. Without one, the completion is the record of the call.
  const existing = await repos.calls.findLatestOnContact({
    userId: input.actorUserId,
    contactId: member.id,
    since: hold.held_at,
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

export function completeContactHoldCall(
  input: CompleteContactHoldCallCommand,
  uow: AppUow<CompleteContactHoldCallTxRepos>,
  operation: OperationContext,
): Promise<Result<ActionSuccess, DomainError>> {
  return uow.run((repos) => completeHoldCall(input, repos, operation));
}
