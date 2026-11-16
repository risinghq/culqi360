import {
  cleanupFreshDb,
  createFreshDb,
  type FreshDbContext,
  insertTestWorkspace,
} from "@tests/support/runtime/db";
import { sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import { migrateToLatest } from "~/server/platform/database/migrate";
import { runAsPlatform } from "~/server/platform/database/workspace-scope";

describe("schema baseline", () => {
  let ctx: FreshDbContext | null = null;

  afterEach(async () => {
    await cleanupFreshDb(ctx);
    ctx = null;
  });

  it("is idempotent and maintains integrity hash", async () => {
    ctx = await createFreshDb("schema-baseline-rerun");
    await migrateToLatest(ctx.db);
    await insertTestWorkspace(ctx.db);

    await ctx.db
      .insertInto("branches")
      .values({ name: "Lima", created_at: new Date() })
      .execute();

    await migrateToLatest(ctx.db);

    const branches = await ctx.db
      .selectFrom("branches")
      .select((eb) => eb.fn.count<number>("id").as("count"))
      .executeTakeFirstOrThrow();
    expect(branches.count).toBe(1);

    const db = ctx.db;
    const integrity = await runAsPlatform(() =>
      sql<{ migrations_hash: string }>`
        SELECT migrations_hash FROM schema_integrity
      `.execute(db),
    );
    expect(integrity.rows.length).toBe(1);
    expect(integrity.rows[0]?.migrations_hash).toBeDefined();
  });
});
