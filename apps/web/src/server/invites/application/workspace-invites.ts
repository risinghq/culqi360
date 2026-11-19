import { auditEntityId } from "~/domain/audit/entity";
import { canAssignRole } from "~/domain/auth/access/member-management";
import { fail, type DomainError } from "~/domain/errors";
import { normalizeEmail } from "~/domain/identity/email";
import type { BranchId, UserInviteId } from "~/domain/ids";
import { addMilliseconds, epochMilliseconds } from "~/domain/time/clock";
import type { OperationContext } from "~/server/platform/operation/context";
import { Err, Ok, type Result } from "~/shared/result";

import type {
  CreateInviteInput,
  InviteDraft,
  InviteIssueResult,
  ManageInviteInput,
  PendingBranchInvite,
  PendingInvite,
  PlaceMemberInput,
  WorkspaceInviteDeps,
  WorkspaceInviteRepos,
  WorkspaceInviteService,
} from "./types";

type DraftRole = {
  id: InviteDraft["roleId"];
  kind: PendingBranchInvite["role"];
  name: string;
};

// The placement rules hold at invite time and again at acceptance, since the
// role or team may change while the invite waits.
async function checkPlacement(
  repos: Pick<WorkspaceInviteRepos, "roles" | "teams">,
  draft: Pick<
    InviteDraft,
    "roleId" | "teamId" | "branchId" | "executiveCategory"
  >,
): Promise<
  Result<
    { role: DraftRole; executiveCategory: InviteDraft["executiveCategory"] },
    DomainError
  >
> {
  const role = await repos.roles.findById(draft.roleId);
  if (!role) {
    return Err(fail("role_not_assignable"));
  }

  // Only an executive carries a category.
  const executiveCategory =
    role.kind === "executive" ? draft.executiveCategory : null;
  if (role.kind === "executive" && executiveCategory === null) {
    return Err(fail("invalid_executive_category"));
  }

  if (draft.teamId !== null) {
    const team = await repos.teams.findById(draft.teamId);
    if (!team || team.branch_id !== draft.branchId) {
      return Err(fail("invalid_team"));
    }
  }

  return Ok({ role, executiveCategory });
}

function issueResult(
  invite: Pick<
    PendingInvite,
    "inviteId" | "email" | "names" | "firstSurname" | "secondSurname"
  >,
  token: string,
  expiresAt: Date,
  roleName: string,
): InviteIssueResult {
  return {
    inviteId: invite.inviteId,
    token,
    expiresAt,
    email: invite.email,
    fullName: {
      names: invite.names,
      firstSurname: invite.firstSurname,
      secondSurname: invite.secondSurname,
    },
    roleName,
  };
}

async function createInvite(
  deps: WorkspaceInviteDeps,
  input: CreateInviteInput,
  operation: OperationContext,
): Promise<Result<InviteIssueResult, DomainError>> {
  const at = operation.operationAt;
  const email = normalizeEmail(input.email);
  const draft: InviteDraft = {
    email,
    names: input.names,
    firstSurname: input.firstSurname,
    secondSurname: input.secondSurname,
    branchId: input.branchId,
    teamId: input.teamId,
    roleId: input.roleId,
    executiveCategory: input.executiveCategory ?? null,
  };

  const placement = await checkPlacement(deps.repos, draft);
  if (!placement.ok) {
    return placement;
  }
  const { role, executiveCategory } = placement.value;
  if (!canAssignRole(input.actor, role)) {
    return Err(fail("role_not_assignable"));
  }

  if (await deps.repos.members.hasActiveWithEmail(email)) {
    return Err(fail("active_user_exists"));
  }

  const pending = await deps.platform.findPendingByEmail(
    deps.workspaceId,
    email,
    at,
  );
  if (pending && pending.branchId !== input.branchId) {
    return Err(fail("invite_pending_other_branch"));
  }

  const issued = await deps.platform.issue(
    deps.workspaceId,
    {
      ...draft,
      executiveCategory,
      createdByUserId: input.actorUserId,
      expiresAt: input.expiresAt ?? addMilliseconds(at, deps.inviteTtlMs),
    },
    at,
  );

  await deps.uow.run(async (tx) => {
    await tx.events.append({
      type: "user_invite_issued",
      entityType: "invite",
      entityId: auditEntityId("invite", issued.inviteId),
      actorUserId: input.actorUserId,
      payload: {
        inviteId: issued.inviteId,
        email,
        expiresAt: epochMilliseconds(issued.expiresAt),
      },
      occurredAt: at,
    });
    return Ok(undefined);
  });

  return Ok(
    issueResult(
      { ...draft, inviteId: issued.inviteId },
      issued.token,
      issued.expiresAt,
      role.name,
    ),
  );
}

// A pending invite in the actor's branch whose role the actor may assign.
async function findManageableInvite(
  deps: WorkspaceInviteDeps,
  input: ManageInviteInput,
  at: Date,
): Promise<Result<{ invite: PendingInvite; role: DraftRole }, DomainError>> {
  const invite = await deps.platform.findPending(
    deps.workspaceId,
    input.inviteId,
    at,
  );
  if (!invite) {
    return Err(fail("invite_not_pending"));
  }
  if (invite.branchId !== input.branchId) {
    return Err(fail("cross_branch_forbidden"));
  }

  const role = await deps.repos.roles.findById(invite.roleId);
  if (!role || !canAssignRole(input.actor, role)) {
    return Err(fail("role_not_assignable"));
  }

  return Ok({ invite, role });
}

async function renewInvite(
  deps: WorkspaceInviteDeps,
  input: ManageInviteInput,
  operation: OperationContext,
): Promise<Result<InviteIssueResult, DomainError>> {
  const at = operation.operationAt;
  const found = await findManageableInvite(deps, input, at);
  if (!found.ok) {
    return found;
  }
  const { invite, role } = found.value;

  const expiresAt = addMilliseconds(at, deps.inviteTtlMs);
  const token = await deps.platform.rotate(
    deps.workspaceId,
    invite.inviteId,
    expiresAt,
  );
  if (token === null) {
    return Err(fail("invite_not_pending"));
  }

  await deps.uow.run(async (tx) => {
    await tx.events.append({
      type: "user_invite_redelivered",
      entityType: "invite",
      entityId: auditEntityId("invite", invite.inviteId),
      actorUserId: input.actorUserId,
      payload: {
        inviteId: invite.inviteId,
        expiresAt: epochMilliseconds(expiresAt),
      },
      occurredAt: at,
    });
    return Ok(undefined);
  });

  return Ok(issueResult(invite, token, expiresAt, role.name));
}

async function revokeInvite(
  deps: WorkspaceInviteDeps,
  input: ManageInviteInput,
  operation: OperationContext,
): Promise<Result<void, DomainError>> {
  const at = operation.operationAt;
  const found = await findManageableInvite(deps, input, at);
  if (!found.ok) {
    return found;
  }

  const revoked = await deps.platform.revoke(
    deps.workspaceId,
    input.inviteId,
    at,
  );
  if (!revoked) {
    return Err(fail("invite_not_pending"));
  }

  return deps.uow.run(async (tx) => {
    await tx.events.append({
      type: "user_invite_revoked",
      entityType: "invite",
      entityId: auditEntityId("invite", input.inviteId),
      actorUserId: input.actorUserId,
      payload: { inviteId: input.inviteId },
      occurredAt: at,
    });
    return Ok(undefined);
  });
}

async function listPendingInvites(
  deps: WorkspaceInviteDeps,
  branchId: BranchId,
  operation: OperationContext,
): Promise<PendingBranchInvite[]> {
  const invites = await deps.platform.listPending(
    deps.workspaceId,
    branchId,
    operation.operationAt,
  );
  const roleIds = [...new Set(invites.map((invite) => invite.roleId))];
  const roles = new Map(
    await Promise.all(
      roleIds.map(
        async (id) => [id, await deps.repos.roles.findById(id)] as const,
      ),
    ),
  );

  // An invite whose role was deleted cannot be accepted; it stays out of the list.
  return invites.flatMap((invite) => {
    const role = roles.get(invite.roleId);
    if (!role) {
      return [];
    }
    return [
      {
        inviteId: invite.inviteId,
        email: invite.email,
        names: invite.names,
        firstSurname: invite.firstSurname,
        secondSurname: invite.secondSurname,
        role: role.kind,
        roleName: role.name,
        teamId: invite.teamId,
        expiresAt: invite.expiresAt,
        createdAt: invite.createdAt,
        createdByUserId: invite.createdByUserId,
        lastDeliveredAt: invite.lastDeliveredAt,
      },
    ];
  });
}

// The platform has already matched the token and the account; this side
// re-checks the placement and writes the member before the platform records
// the membership, so a failure here leaves nothing behind.
async function placeMember(
  deps: WorkspaceInviteDeps,
  input: PlaceMemberInput,
  placedAt: Date,
): Promise<Result<{ role: PendingBranchInvite["role"] }, DomainError>> {
  return deps.uow.run(async (tx) => {
    const placement = await checkPlacement(tx, input);
    if (!placement.ok) {
      return placement;
    }
    const { role, executiveCategory } = placement.value;

    await tx.members.upsertActive(input.userId, {
      branch_id: input.branchId,
      team_id: input.teamId,
      role_id: role.id,
      role: role.kind,
      executive_category: executiveCategory,
      expires_at: null,
      username: input.username,
      email: input.email,
      names: input.names,
      first_surname: input.firstSurname,
      second_surname: input.secondSurname,
      avatar_storage_key: input.avatarStorageKey,
      avatar_version: input.avatarVersion,
      created_at: placedAt,
    });
    await tx.events.append({
      type: "user_invite_accepted",
      entityType: "user",
      entityId: auditEntityId("user", input.userId),
      actorUserId: input.userId,
      payload: { inviteId: input.inviteId },
      occurredAt: placedAt,
    });

    return Ok({ role: role.kind });
  });
}

export function createWorkspaceInviteService(
  deps: WorkspaceInviteDeps,
): WorkspaceInviteService {
  return {
    listPendingInvites: (branchId, operation) =>
      listPendingInvites(deps, branchId, operation),
    createInvite: (input, operation) => createInvite(deps, input, operation),
    renewInvite: (input, operation) => renewInvite(deps, input, operation),
    revokeInvite: (input, operation) => revokeInvite(deps, input, operation),
    markInviteDelivered: (inviteId: UserInviteId, operation) =>
      deps.platform.markDelivered(
        deps.workspaceId,
        inviteId,
        operation.operationAt,
      ),
    placeMember: (input, placedAt) => placeMember(deps, input, placedAt),
  };
}
