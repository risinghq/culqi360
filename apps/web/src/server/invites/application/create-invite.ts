import { canAssignRole } from "~/domain/auth/access/member-management";
import { fail, type DomainError } from "~/domain/errors";
import { generateUsername } from "~/domain/identity/generate-username";
import type { OperationContext } from "~/server/platform/operation/context";
import { Err, Ok, type Result } from "~/shared/result";

import {
  buildPendingIdentity,
  normalizeInviteEmail,
} from "../domain/pending-identity";
import { issueInvite } from "./issue-invite";
import type {
  CreateInviteInput,
  InviteBaseRepos,
  InviteIssueResult,
  InviteRuntime,
} from "./types";

const USERNAME_ALLOCATION_ATTEMPTS = 3;

async function insertPendingUser(
  repos: Pick<InviteBaseRepos, "users">,
  draft: Omit<Parameters<typeof buildPendingIdentity>[0], "username">,
) {
  for (let attempt = 0; attempt < USERNAME_ALLOCATION_ATTEMPTS; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const username = await generateUsername(
      draft.names,
      draft.firstSurname,
      draft.secondSurname,
      async (candidate) =>
        (await repos.users.findByUsername(candidate)) !== undefined,
    );

    // eslint-disable-next-line no-await-in-loop
    const inserted = await repos.users.create(
      buildPendingIdentity({ ...draft, username }),
    );

    if (inserted) {
      return inserted;
    }

    // eslint-disable-next-line no-await-in-loop
    if (await repos.users.findByEmail(draft.email)) {
      return undefined;
    }
  }

  throw new Error(
    `Could not allocate a username for invite ${draft.email}: lost ${USERNAME_ALLOCATION_ATTEMPTS} consecutive races`,
  );
}

export async function createInvite(
  runtime: InviteRuntime,
  input: CreateInviteInput,
  operation: OperationContext,
): Promise<Result<InviteIssueResult, DomainError>> {
  const normalizedEmail = normalizeInviteEmail(input.email);

  return runtime.uow.run(async (transactionRepos) => {
    const role = await transactionRepos.roles.findById(input.roleId);
    if (!role || !canAssignRole(input.actor, role)) {
      return Err(fail("role_not_assignable"));
    }

    // Only an executive carries a category.
    const executiveCategory =
      role.kind === "executive" ? (input.executiveCategory ?? null) : null;
    if (role.kind === "executive" && executiveCategory === null) {
      return Err(fail("invalid_executive_category"));
    }

    if (input.teamId !== null) {
      const team = await transactionRepos.teams.findById(input.teamId);

      if (!team || team.branch_id !== input.branchId) {
        return Err(fail("invalid_team"));
      }
    }

    let user = await transactionRepos.users.findByEmail(normalizedEmail);

    if (user?.is_active) {
      return Err(fail("active_user_exists"));
    }

    if (user && user.branch_id !== input.branchId) {
      return Err(fail("pending_user_other_branch"));
    }

    if (!user) {
      const inserted = await insertPendingUser(transactionRepos, {
        branchId: input.branchId,
        teamId: input.teamId,
        email: normalizedEmail,
        roleId: role.id,
        role: role.kind,
        names: input.names,
        firstSurname: input.firstSurname,
        secondSurname: input.secondSurname,
        executiveCategory,
        createdAt: operation.operationAt,
      });

      // Reuse the user created by a concurrent invite for the same email.
      const racedUser =
        inserted ?? (await transactionRepos.users.findByEmail(normalizedEmail));

      if (!racedUser) {
        return Err(fail("invite_target_missing"));
      }

      if (racedUser.is_active) {
        return Err(fail("active_user_exists"));
      }

      if (racedUser.branch_id !== input.branchId) {
        return Err(fail("pending_user_other_branch"));
      }

      user = racedUser;
    }

    await transactionRepos.users.updateInviteProvisioning(user.id, {
      team_id: input.teamId,
      names: input.names,
      first_surname: input.firstSurname,
      second_surname: input.secondSurname,
      role_id: role.id,
      role: role.kind,
      executive_category: executiveCategory,
      is_active: false,
    });

    const issued = await issueInvite(
      transactionRepos,
      runtime,
      {
        actorUserId: input.actorUserId,
        branchId: input.branchId,
        userId: user.id,
        email: normalizedEmail,
        expiresAt: input.expiresAt ?? null,
      },
      operation.operationAt,
    );

    return Ok({ ...issued, roleName: role.name });
  });
}
