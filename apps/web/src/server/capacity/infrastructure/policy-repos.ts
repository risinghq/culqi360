import type { Kysely } from "kysely";

import {
  newRowId,
  type BranchId,
  type TeamId,
  type UserId,
} from "~/domain/ids";
import type { WorkspaceDatabase } from "~/server/platform/database/types";

type DefaultScopeType = "branch" | "team";
type DefaultScopeId = BranchId | TeamId;

export function createSearchPolicyDefaultsRepo(db: Kysely<WorkspaceDatabase>) {
  const findForScope = (scopeType: DefaultScopeType, scopeId: DefaultScopeId) =>
    db
      .selectFrom("search_policy_defaults")
      .selectAll()
      .where("scope_type", "=", scopeType)
      .where("scope_id", "=", scopeId)
      .executeTakeFirst();

  const listForScope = (
    scopeType: DefaultScopeType,
    scopeIds: DefaultScopeId[],
  ) => {
    if (scopeIds.length === 0) {
      return Promise.resolve([]);
    }

    return db
      .selectFrom("search_policy_defaults")
      .selectAll()
      .where("scope_type", "=", scopeType)
      .where("scope_id", "in", scopeIds)
      .execute();
  };

  const upsert = async (values: {
    scope_type: DefaultScopeType;
    scope_id: DefaultScopeId;
    period_type: "month";
    search_limit: number;
    created_at: Date;
    updated_at: Date;
  }): Promise<void> => {
    await db
      .insertInto("search_policy_defaults")
      .values({ id: newRowId(), ...values })
      .onConflict((oc) =>
        oc.columns(["scope_type", "scope_id"]).doUpdateSet(values),
      )
      .execute();
  };

  return {
    findForScope,
    listForScope,
    upsert,
  };
}

export function createSearchPolicyOverridesRepo(db: Kysely<WorkspaceDatabase>) {
  const findActiveForUser = (userId: UserId, activeAsOf: Date) =>
    db
      .selectFrom("search_policy_overrides")
      .selectAll()
      .where("user_id", "=", userId)
      .where("effective_from", "<=", activeAsOf)
      .where((eb) =>
        eb.or([
          eb("expires_at", "is", null),
          eb("expires_at", ">", activeAsOf),
        ]),
      )
      .orderBy("created_at", "desc")
      .executeTakeFirst();

  const listActiveForUsers = (userIds: UserId[], activeAsOf: Date) => {
    if (userIds.length === 0) {
      return Promise.resolve([]);
    }

    return db
      .selectFrom("search_policy_overrides")
      .selectAll()
      .where("user_id", "in", userIds)
      .where("effective_from", "<=", activeAsOf)
      .where((eb) =>
        eb.or([
          eb("expires_at", "is", null),
          eb("expires_at", ">", activeAsOf),
        ]),
      )
      .orderBy("user_id", "asc")
      .orderBy("created_at", "desc")
      .execute();
  };

  const replaceForUser = async (values: {
    user_id: UserId;
    search_limit: number;
    effective_from: Date;
    expires_at: Date | null;
    set_by_user_id: UserId;
    created_at: Date;
  }): Promise<void> => {
    await db.transaction().execute(async (trx) => {
      await trx
        .deleteFrom("search_policy_overrides")
        .where("user_id", "=", values.user_id)
        .execute();

      await trx
        .insertInto("search_policy_overrides")
        .values({ id: newRowId(), ...values })
        .executeTakeFirstOrThrow();
    });
  };

  return {
    findActiveForUser,
    listActiveForUsers,
    replaceForUser,
  };
}

export function createDrawPolicyDefaultsRepo(db: Kysely<WorkspaceDatabase>) {
  const findForScope = (scopeType: DefaultScopeType, scopeId: DefaultScopeId) =>
    db
      .selectFrom("draw_policy_defaults")
      .selectAll()
      .where("scope_type", "=", scopeType)
      .where("scope_id", "=", scopeId)
      .executeTakeFirst();

  const listForScope = (
    scopeType: DefaultScopeType,
    scopeIds: DefaultScopeId[],
  ) => {
    if (scopeIds.length === 0) {
      return Promise.resolve([]);
    }

    return db
      .selectFrom("draw_policy_defaults")
      .selectAll()
      .where("scope_type", "=", scopeType)
      .where("scope_id", "in", scopeIds)
      .execute();
  };

  const upsert = async (values: {
    scope_type: DefaultScopeType;
    scope_id: DefaultScopeId;
    active_buffer_target: number;
    daily_refill_limit: number;
    created_at: Date;
    updated_at: Date;
  }): Promise<void> => {
    await db
      .insertInto("draw_policy_defaults")
      .values({ id: newRowId(), ...values })
      .onConflict((oc) =>
        oc.columns(["scope_type", "scope_id"]).doUpdateSet(values),
      )
      .execute();
  };

  return {
    findForScope,
    listForScope,
    upsert,
  };
}

export function createDrawPolicyOverridesRepo(db: Kysely<WorkspaceDatabase>) {
  const findActiveForUser = (userId: UserId, activeAsOf: Date) =>
    db
      .selectFrom("draw_policy_overrides")
      .selectAll()
      .where("user_id", "=", userId)
      .where("effective_from", "<=", activeAsOf)
      .where((eb) =>
        eb.or([
          eb("expires_at", "is", null),
          eb("expires_at", ">", activeAsOf),
        ]),
      )
      .orderBy("created_at", "desc")
      .executeTakeFirst();

  const listActiveForUsers = (userIds: UserId[], activeAsOf: Date) => {
    if (userIds.length === 0) {
      return Promise.resolve([]);
    }

    return db
      .selectFrom("draw_policy_overrides")
      .selectAll()
      .where("user_id", "in", userIds)
      .where("effective_from", "<=", activeAsOf)
      .where((eb) =>
        eb.or([
          eb("expires_at", "is", null),
          eb("expires_at", ">", activeAsOf),
        ]),
      )
      .orderBy("user_id", "asc")
      .orderBy("created_at", "desc")
      .execute();
  };

  const replaceForUser = async (values: {
    user_id: UserId;
    active_buffer_target: number;
    daily_refill_limit: number;
    effective_from: Date;
    expires_at: Date | null;
    set_by_user_id: UserId;
    created_at: Date;
  }): Promise<void> => {
    await db.transaction().execute(async (trx) => {
      await trx
        .deleteFrom("draw_policy_overrides")
        .where("user_id", "=", values.user_id)
        .execute();

      await trx
        .insertInto("draw_policy_overrides")
        .values({ id: newRowId(), ...values })
        .executeTakeFirstOrThrow();
    });
  };

  return {
    findActiveForUser,
    listActiveForUsers,
    replaceForUser,
  };
}

export type SearchPolicyDefaultsRepo = ReturnType<
  typeof createSearchPolicyDefaultsRepo
>;

export type SearchPolicyOverridesRepo = ReturnType<
  typeof createSearchPolicyOverridesRepo
>;

export type DrawPolicyDefaultsRepo = ReturnType<
  typeof createDrawPolicyDefaultsRepo
>;

export type DrawPolicyOverridesRepo = ReturnType<
  typeof createDrawPolicyOverridesRepo
>;
