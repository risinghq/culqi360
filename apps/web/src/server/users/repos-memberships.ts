import type { UserId, WorkspaceId } from "~/domain/ids";
import type { PlatformExecutor } from "~/server/platform/database/executor";

// Platform store. A membership says which workspace stores hold a member row
// for the account; the row itself lives in that workspace.
export function createMembershipsRepo(db: PlatformExecutor) {
  return {
    async add(
      accountId: UserId,
      workspaceId: WorkspaceId,
      createdAt: Date,
    ): Promise<void> {
      await db
        .insertInto("memberships")
        .values({
          account_id: accountId,
          workspace_id: workspaceId,
          created_at: createdAt,
        })
        .onConflict((oc) => oc.doNothing())
        .execute();
    },

    // Ending a membership ends the account's sessions in that workspace
    // through the foreign key.
    async remove(accountId: UserId, workspaceId: WorkspaceId): Promise<void> {
      await db
        .deleteFrom("memberships")
        .where("account_id", "=", accountId)
        .where("workspace_id", "=", workspaceId)
        .execute();
    },

    async has(accountId: UserId, workspaceId: WorkspaceId): Promise<boolean> {
      const row = await db
        .selectFrom("memberships")
        .select("account_id")
        .where("account_id", "=", accountId)
        .where("workspace_id", "=", workspaceId)
        .executeTakeFirst();
      return row !== undefined;
    },

    listWorkspacesForAccount(accountId: UserId) {
      return db
        .selectFrom("memberships")
        .innerJoin("workspaces", "workspaces.id", "memberships.workspace_id")
        .select(["workspaces.id", "workspaces.name"])
        .where("memberships.account_id", "=", accountId)
        .orderBy("workspaces.name", "asc")
        .execute();
    },
  };
}

export type MembershipsRepo = ReturnType<typeof createMembershipsRepo>;
