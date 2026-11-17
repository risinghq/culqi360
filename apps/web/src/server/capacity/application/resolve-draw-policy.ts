import { fail, type DomainError } from "~/domain/errors";
import type { BranchId, TeamId, UserId } from "~/domain/ids";
import type { OperationContext } from "~/server/platform/operation/context";
import { Err, Ok, type Result } from "~/shared/result";

import { resolveDrawPolicy, type DrawPolicy } from "../domain/policy";
import type { ActorScope } from "./actor-scope";

export type SetDrawScopeDefaultCommand =
  | {
      scopeType: "branch";
      scopeId: BranchId;
      bufferTarget: number;
      dailyLimit: number;
    }
  | {
      scopeType: "team";
      scopeId: TeamId;
      bufferTarget: number;
      dailyLimit: number;
    };

export interface SetDrawUserOverrideCommand {
  actorUserId: UserId;
  targetUserId: UserId;
  bufferTarget: number;
  dailyLimit: number;
  expiresAt: Date | null;
}

interface PolicyRepos {
  users: {
    findById(id: UserId): Promise<ActorScope | undefined>;
  };
  drawPolicyDefaults: {
    findForScope(
      scopeType: "branch" | "team",
      scopeId: BranchId | TeamId,
    ): Promise<
      | {
          active_buffer_target: number;
          daily_refill_limit: number;
        }
      | undefined
      | null
    >;
  };
  drawPolicyOverrides: {
    findActiveForUser(
      userId: UserId,
      activeAsOf: Date,
    ): Promise<
      | {
          active_buffer_target: number;
          daily_refill_limit: number;
        }
      | undefined
      | null
    >;
  };
}

interface DrawPolicyDefaultsWriter {
  drawPolicyDefaults: {
    upsert(values: {
      scope_type: "branch" | "team";
      scope_id: BranchId | TeamId;
      active_buffer_target: number;
      daily_refill_limit: number;
    }): Promise<unknown>;
  };
}

interface DrawPolicyOverridesWriter {
  drawPolicyOverrides: {
    replaceForUser(values: {
      user_id: UserId;
      active_buffer_target: number;
      daily_refill_limit: number;
      effective_from: Date;
      expires_at: Date | null;
      set_by_user_id: UserId;
      created_at: Date;
    }): Promise<unknown>;
  };
}

export async function getEffectiveDrawPolicy(
  userId: UserId,
  repos: PolicyRepos,
  operation: OperationContext,
): Promise<Result<DrawPolicy, DomainError>> {
  const user = await repos.users.findById(userId);
  if (!user) {
    return Err(fail("user_not_found"));
  }

  const userOverride = await repos.drawPolicyOverrides.findActiveForUser(
    userId,
    operation.operationAt,
  );
  const teamDefault = user.teamId
    ? await repos.drawPolicyDefaults.findForScope("team", user.teamId)
    : null;
  const branchDefault = await repos.drawPolicyDefaults.findForScope(
    "branch",
    user.branchId,
  );

  return Ok(resolveDrawPolicy({ userOverride, teamDefault, branchDefault }));
}

export async function setDrawScopeDefault(
  command: SetDrawScopeDefaultCommand,
  repos: DrawPolicyDefaultsWriter,
): Promise<Result<void, DomainError>> {
  await repos.drawPolicyDefaults.upsert({
    scope_type: command.scopeType,
    scope_id: command.scopeId,
    active_buffer_target: command.bufferTarget,
    daily_refill_limit: command.dailyLimit,
  });
  return Ok(undefined);
}

export async function setDrawUserOverride(
  command: SetDrawUserOverrideCommand,
  repos: DrawPolicyOverridesWriter,
  operation: OperationContext,
): Promise<Result<void, DomainError>> {
  await repos.drawPolicyOverrides.replaceForUser({
    user_id: command.targetUserId,
    active_buffer_target: command.bufferTarget,
    daily_refill_limit: command.dailyLimit,
    effective_from: operation.operationAt,
    created_at: operation.operationAt,
    expires_at: command.expiresAt,
    set_by_user_id: command.actorUserId,
  });
  return Ok(undefined);
}
