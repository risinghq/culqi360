import { type ColumnType, Kysely, sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createBunSqliteStore } from "~/server/platform/database/bun-store";
import { createSqliteStoreDialect } from "~/server/platform/database/driver";

// The decoder here is the identity, so a select returns what SQLite stored
// while an insert may pass the values the driver encodes.
type Schema = {
  notes: {
    id: string;
    body: string;
    done: ColumnType<number, boolean | number, boolean | number>;
    created_at: ColumnType<string, Date | string, Date | string>;
  };
};

describe("SQLite store dialect", () => {
  let store: ReturnType<typeof createBunSqliteStore>;
  let db: Kysely<Schema>;

  beforeEach(async () => {
    store = createBunSqliteStore();
    db = new Kysely<Schema>({
      dialect: createSqliteStoreDialect(store, (row) => row),
    });
    await sql`create table notes (id text primary key, body text not null, done integer not null, created_at text not null)`.execute(
      db,
    );
  });

  afterEach(() => {
    store.close();
  });

  it("commits a transaction that resolves", async () => {
    await db.transaction().execute(async (tx) => {
      await tx
        .insertInto("notes")
        .values({ id: "a", body: "one", done: 0, created_at: "x" })
        .execute();
    });

    const rows = await db.selectFrom("notes").select("id").execute();
    expect(rows).toEqual([{ id: "a" }]);
  });

  it("rolls back every write of a transaction that throws", async () => {
    await expect(
      db.transaction().execute(async (tx) => {
        await tx
          .insertInto("notes")
          .values({ id: "a", body: "one", done: 0, created_at: "x" })
          .execute();
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");

    const rows = await db.selectFrom("notes").select("id").execute();
    expect(rows).toEqual([]);
  });

  it("keeps a query outside the transaction from landing inside it", async () => {
    let releaseTx!: () => void;
    const paused = new Promise<void>((resolve) => {
      releaseTx = resolve;
    });

    const tx = db.transaction().execute(async (trx) => {
      await trx
        .insertInto("notes")
        .values({ id: "in-tx", body: "one", done: 0, created_at: "x" })
        .execute();
      await paused;
      throw new Error("abort");
    });
    const outside = db
      .insertInto("notes")
      .values({ id: "outside", body: "two", done: 0, created_at: "x" })
      .execute();

    releaseTx();
    await expect(tx).rejects.toThrow("abort");
    await outside;

    const rows = await db.selectFrom("notes").select("id").execute();
    expect(rows).toEqual([{ id: "outside" }]);
  });

  it("reports the rows an update changed and binds dates and booleans", async () => {
    const at = new Date("2026-11-18T12:00:00.000Z");
    await db
      .insertInto("notes")
      .values([
        { id: "a", body: "one", done: false, created_at: at },
        { id: "b", body: "two", done: true, created_at: at },
      ])
      .execute();

    const result = await db
      .updateTable("notes")
      .set({ body: "changed" })
      .where("done", "=", 0)
      .executeTakeFirstOrThrow();

    expect(result.numUpdatedRows).toBe(1n);
    const row = await db
      .selectFrom("notes")
      .selectAll()
      .where("id", "=", "b")
      .executeTakeFirstOrThrow();
    expect(row).toEqual({
      id: "b",
      body: "two",
      done: 1,
      created_at: "2026-11-18T12:00:00.000Z",
    });
  });
});
