import {
  cleanupTestDb,
  createIsolatedTestDb,
  insertWorkspace,
  resetTestDb,
  TEST_FIXTURES,
  type TestDbContext,
} from "@tests/support/runtime/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { WorkspaceId } from "~/domain/ids";
import {
  runAsPlatform,
  runInWorkspace,
} from "~/server/platform/database/workspace-scope";

const OTHER_WORKSPACE_ID = WorkspaceId.trust(
  "01974fd5-f261-7a7d-93f5-2f3d0f965002",
);
const FIXTURE_ORG = TEST_FIXTURES.organizations.lima;

function inOtherWorkspace<T>(fn: () => Promise<T>): Promise<T> {
  return runInWorkspace(OTHER_WORKSPACE_ID, fn);
}

describe("workspace isolation", () => {
  let ctx: TestDbContext;

  beforeAll(async () => {
    ctx = await createIsolatedTestDb("workspace-isolation");
  });

  afterAll(async () => {
    await cleanupTestDb(ctx);
  });

  beforeEach(async () => {
    await resetTestDb(ctx);
    await insertWorkspace(ctx.db, { id: OTHER_WORKSPACE_ID, name: "Other" });
  });

  function organizationIds(): Promise<string[]> {
    return ctx.db
      .selectFrom("organizations")
      .select("id")
      .execute()
      .then((rows) => rows.map((row) => row.id));
  }

  it("hides another workspace's rows", async () => {
    expect(await organizationIds()).toContain(FIXTURE_ORG.id);
    expect(await inOtherWorkspace(organizationIds)).toEqual([]);
  });

  it("leaves another workspace's rows unchanged on update and delete", async () => {
    const updated = await inOtherWorkspace(() =>
      ctx.db
        .updateTable("organizations")
        .set({ legal_name: "Taken" })
        .executeTakeFirst(),
    );
    const deleted = await inOtherWorkspace(() =>
      ctx.db.deleteFrom("organizations").executeTakeFirst(),
    );

    expect(updated.numUpdatedRows).toBe(0n);
    expect(deleted.numDeletedRows).toBe(0n);
    expect(
      await ctx.db
        .selectFrom("organizations")
        .select("legal_name")
        .where("id", "=", FIXTURE_ORG.id)
        .executeTakeFirstOrThrow(),
    ).toEqual({ legal_name: "Org Lima" });
  });

  it("tags new rows with the current workspace and refuses a foreign tag", async () => {
    const inserted = await inOtherWorkspace(() =>
      ctx.db
        .insertInto("organizations")
        .values({
          ruc: FIXTURE_ORG.ruc,
          legal_name: "Same RUC",
          created_at: new Date(),
        })
        .returning("workspace_id")
        .executeTakeFirstOrThrow(),
    );

    expect(inserted.workspace_id).toBe(OTHER_WORKSPACE_ID);

    await expect(
      inOtherWorkspace(() =>
        ctx.db
          .insertInto("organizations")
          .values({
            workspace_id: TEST_FIXTURES.workspace.id,
            ruc: "20100000099",
            legal_name: "Foreign",
            created_at: new Date(),
          })
          .execute(),
      ),
    ).rejects.toThrow("row-level security");
  });

  it("tags a platform-scope event with its user's workspace", async () => {
    const workspaceIds = await runAsPlatform(async () => {
      const rows = await ctx.db
        .insertInto("events")
        .values(
          [TEST_FIXTURES.users.execOne.id, null].map((subjectUserId) => ({
            id: crypto.randomUUID(),
            entity_type: "user",
            entity_id: "test",
            type: "test_event",
            subject_user_id: subjectUserId,
            occurred_at: new Date(),
          })),
        )
        .returning("workspace_id")
        .execute();
      return rows.map((row) => row.workspace_id);
    });

    expect(workspaceIds).toEqual([TEST_FIXTURES.workspace.id, null]);
  });
});
