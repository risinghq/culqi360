import { hashInviteToken } from "~/domain/auth/invite/tokens";
import { fail, type DomainError } from "~/domain/errors";
import { longName } from "~/domain/identity/display-name";
import { generateUsername } from "~/domain/identity/generate-username";
import { UserId } from "~/domain/ids";
import type { OperationContext } from "~/server/platform/operation/context";
import type { InviteRow } from "~/server/users/repos-user-invites";
import { Err, Ok, type Result } from "~/shared/result";

import type {
  AcceptInviteDeps,
  AcceptInviteInput,
  InviteAcceptanceService,
  InviteAcceptedResult,
  PendingInviteInfo,
} from "./types";

type AccountRow = NonNullable<
  Awaited<ReturnType<AcceptInviteDeps["repos"]["accounts"]["findByEmail"]>>
>;

// The person the invite resolves to. An email that already has an account
// joins with that account and its identity; otherwise acceptance creates one.
type InviteHolder =
  | { kind: "existing"; account: AccountRow }
  | { kind: "new"; userId: UserId; username: string };

async function resolveHolder(
  deps: AcceptInviteDeps,
  invite: InviteRow,
): Promise<InviteHolder> {
  const account = await deps.repos.accounts.findByEmail(invite.email);
  if (account) {
    return { kind: "existing", account };
  }
  const username = await generateUsername(
    invite.names,
    invite.first_surname,
    invite.second_surname,
    deps.repos.accounts.isUsernameTaken,
  );
  return { kind: "new", userId: UserId.mint(), username };
}

async function findInviteInfo(
  deps: AcceptInviteDeps,
  token: string,
  operation: OperationContext,
): Promise<PendingInviteInfo | null> {
  const invite = await deps.repos.invites.findPendingByTokenHash(
    hashInviteToken(token),
    operation.operationAt,
  );
  if (!invite) {
    return null;
  }

  const holder = await resolveHolder(deps, invite);
  return holder.kind === "existing"
    ? {
        fullName: longName(holder.account),
        email: holder.account.email,
        username: holder.account.username,
        hasAccount: true,
      }
    : {
        fullName: longName(invite),
        email: invite.email,
        username: holder.username,
        hasAccount: false,
      };
}

// The workspace places the member first and the platform records the
// acceptance after, so a placement the workspace refuses leaves the invite
// pending. Two submits of one link race on markAccepted; the loser fails.
async function acceptInvite(
  deps: AcceptInviteDeps,
  input: AcceptInviteInput,
  operation: OperationContext,
): Promise<Result<InviteAcceptedResult, DomainError>> {
  const at = operation.operationAt;
  const invite = await deps.repos.invites.findPendingByTokenHash(
    hashInviteToken(input.token),
    at,
  );
  if (!invite) {
    return Err(fail("invite_invalid_or_expired"));
  }

  const holder = await resolveHolder(deps, invite);
  if (
    holder.kind === "existing" &&
    !(await deps.verifyPassword(holder.account.password_hash, input.password))
  ) {
    return Err(fail("invite_account_password_mismatch"));
  }

  const identity =
    holder.kind === "existing"
      ? {
          userId: holder.account.id,
          username: holder.account.username,
          names: holder.account.names,
          firstSurname: holder.account.first_surname,
          secondSurname: holder.account.second_surname,
          avatarStorageKey: holder.account.avatar_storage_key,
          avatarVersion: holder.account.avatar_version,
        }
      : {
          userId: holder.userId,
          username: holder.username,
          names: invite.names,
          firstSurname: invite.first_surname,
          secondSurname: invite.second_surname,
          avatarStorageKey: null,
          avatarVersion: 0,
        };

  const placed = await deps.workspaces.placeMember(
    invite.workspace_id,
    {
      ...identity,
      inviteId: invite.id,
      email: invite.email,
      branchId: invite.branch_id,
      teamId: invite.team_id,
      roleId: invite.role_id,
      executiveCategory: invite.executive_category,
    },
    at,
  );
  if (!placed.ok) {
    return placed;
  }

  const passwordHash =
    holder.kind === "new" ? await deps.hashPassword(input.password) : null;

  // The account comes first because the invite references it. A lost race
  // returns Err, which rolls the new account back.
  return deps.uow.run(async (tx) => {
    if (passwordHash !== null) {
      await tx.accounts.create({
        id: identity.userId,
        username: identity.username,
        email: invite.email,
        password_hash: passwordHash,
        names: identity.names,
        first_surname: identity.firstSurname,
        second_surname: identity.secondSurname,
        created_at: at,
      });
    }
    const accepted = await tx.invites.markAccepted(
      invite.id,
      identity.userId,
      at,
    );
    if (!accepted) {
      return Err(fail("invite_invalid_or_expired"));
    }
    await tx.memberships.add(identity.userId, invite.workspace_id, at);

    return Ok({
      accountId: identity.userId,
      workspaceId: invite.workspace_id,
      role: placed.value.role,
    });
  });
}

export function createInviteAcceptanceService(
  deps: AcceptInviteDeps,
): InviteAcceptanceService {
  return {
    findInviteInfo: (token, operation) =>
      findInviteInfo(deps, token, operation),
    acceptInvite: (input, operation) => acceptInvite(deps, input, operation),
  };
}
