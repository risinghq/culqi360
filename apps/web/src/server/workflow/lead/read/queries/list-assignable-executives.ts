import type { AssignableExecutiveView } from "~/contracts/workflow/views";
import { fail, type DomainError } from "~/domain/errors";
import type { WorkflowLeadId } from "~/domain/ids";
import type { WorkflowActor } from "~/server/workflow/actor";
import {
  authorizeLeadAction,
  requireCapability,
  resolveAssignableExecutivesScope,
} from "~/server/workflow/lead/domain/policy";
import type { LeadReader } from "~/server/workflow/lead/read/ports";
import type { WorkflowUserRepository } from "~/server/workflow/lead/read/users-repo";
import { Err, Ok, type Result } from "~/shared/result";

type AssignableExecutivesQueryDeps = {
  leads: LeadReader;
  users: WorkflowUserRepository;
};

export async function listAssignableExecutives(
  deps: AssignableExecutivesQueryDeps,
  input: {
    actor: WorkflowActor;
    leadId: WorkflowLeadId;
    search?: string;
    limit?: number;
  },
): Promise<Result<AssignableExecutiveView[], DomainError>> {
  const { actor } = input;
  const canReassign = requireCapability("reassign", actor);
  if (!canReassign.ok) {
    return canReassign;
  }

  const lead = await deps.leads.findById(input.leadId);
  if (!lead) {
    return Err(fail("lead_not_found"));
  }

  const canAccess = authorizeLeadAction("view", actor, lead);
  if (!canAccess.ok) {
    return canAccess;
  }

  const scope = resolveAssignableExecutivesScope({
    actorRole: actor.role,
    actorBranchId: actor.branchId,
  });
  if (!scope.ok) {
    return scope;
  }

  const users = await deps.users.listAssignableExecutives(scope.value, {
    search: input.search,
    limit: input.limit,
  });

  return Ok(users);
}
