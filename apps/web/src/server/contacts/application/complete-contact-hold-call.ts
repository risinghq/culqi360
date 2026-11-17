import type { ActionSuccess } from "~/contracts/common";
import { fail, type DomainError } from "~/domain/errors";
import {
  recordResult,
  type RecordResultRepos,
} from "~/server/activities/application/record-result";
import { normalizePhone } from "~/server/calls/domain/call-target";
import type { ContactHoldsRepo } from "~/server/contacts/infrastructure/hold-repo";
import type { OrganizationRepository } from "~/server/organization/organization-repo";
import type { AppUow } from "~/server/platform/database/uow";
import type { OperationContext } from "~/server/platform/operation/context";
import { Err, Ok, isErr, type Result } from "~/shared/result";

import type { CompleteContactHoldCallCommand } from "./contracts";

type CompleteContactHoldCallTxRepos = RecordResultRepos & {
  contactHolds: Pick<
    ContactHoldsRepo,
    "findActiveByIdForUser" | "markCompleted"
  >;
  organization: Pick<OrganizationRepository, "findMembershipById">;
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

  const recorded = await recordResult(
    {
      actorUserId: input.actorUserId,
      branchId: input.branchId,
      organizationId: member.organizationId,
      subject: { kind: "contact", contactId: member.id },
      phone: normalizePhone(member.phone ?? ""),
      since: hold.held_at,
      at,
      outcomeId: input.outcomeId,
      notes: input.notes,
    },
    repos,
  );
  if (isErr(recorded)) {
    return recorded;
  }

  await repos.contactHolds.markCompleted(input.holdId, input.actorUserId);
  return Ok({ success: true });
}

export function completeContactHoldCall(
  input: CompleteContactHoldCallCommand,
  uow: AppUow<CompleteContactHoldCallTxRepos>,
  operation: OperationContext,
): Promise<Result<ActionSuccess, DomainError>> {
  return uow.run((repos) => completeHoldCall(input, repos, operation));
}
