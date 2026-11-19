import { Kysely, sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import { createBunSqliteStore } from "~/server/platform/database/bun-store";
import {
  createRowDecoder,
  readColumnKinds,
} from "~/server/platform/database/codec";
import { createSqliteStoreDialect } from "~/server/platform/database/driver";

type Schema = {
  records: {
    id: string;
    worked: boolean;
    facts: unknown;
    tags: string[];
    held_at: Date | null;
    due_on: string;
  };
};

describe("SQLite column codec", () => {
  let store: ReturnType<typeof createBunSqliteStore>;

  afterEach(() => {
    store.close();
  });

  it("returns stored values as the kinds their columns declare", async () => {
    store = createBunSqliteStore();
    store.exec(
      `create table records (id text primary key, worked boolean not null,
         facts json not null, tags json not null, held_at timestamptz,
         due_on date not null)`,
      [],
    );
    const db = new Kysely<Schema>({
      dialect: createSqliteStoreDialect(
        store,
        createRowDecoder(readColumnKinds(store)),
      ),
    });
    const at = new Date("2026-11-18T12:00:00.000Z");

    await db
      .insertInto("records")
      .values([
        {
          id: "a",
          worked: true,
          facts: { ruc: "20123456789", score: 5 },
          tags: ["x", "y"],
          held_at: at,
          due_on: "2026-11-20",
        },
        {
          id: "b",
          worked: false,
          facts: {},
          tags: [],
          held_at: null,
          due_on: "2026-11-21",
        },
      ])
      .execute();

    const rows = await db
      .selectFrom("records")
      .selectAll()
      .orderBy("id")
      .execute();
    expect(rows).toEqual([
      {
        id: "a",
        worked: true,
        facts: { ruc: "20123456789", score: 5 },
        tags: ["x", "y"],
        held_at: at,
        due_on: "2026-11-20",
      },
      {
        id: "b",
        worked: false,
        facts: {},
        tags: [],
        held_at: null,
        due_on: "2026-11-21",
      },
    ]);
  });

  it("decodes a selected alias as the column it names", async () => {
    store = createBunSqliteStore();
    store.exec(
      "create table records (id text primary key, worked boolean not null, facts json not null, tags json not null, held_at timestamptz, due_on date not null)",
      [],
    );
    store.exec(
      `insert into records values ('a', 1, '{"n":1}', '[]', '2026-11-18T12:00:00.000Z', '2026-11-20')`,
      [],
    );
    const db = new Kysely<Schema>({
      dialect: createSqliteStoreDialect(
        store,
        createRowDecoder(readColumnKinds(store)),
      ),
    });

    const row = await db
      .selectFrom("records as r")
      .select((eb) => [
        "r.held_at as heldAt",
        "worked as isWorked",
        eb.fn.max("r.held_at").as("lastHeldAt"),
        eb.fn.count<number>("r.id").as("total"),
        eb.selectFrom("records").select("facts").limit(1).as("firstFacts"),
        sql<string>`json_object('n', 2)`.as("tags"),
      ])
      .executeTakeFirstOrThrow();

    expect(row).toEqual({
      heldAt: new Date("2026-11-18T12:00:00.000Z"),
      isWorked: true,
      lastHeldAt: new Date("2026-11-18T12:00:00.000Z"),
      total: 1,
      firstFacts: { n: 1 },
      tags: '{"n":2}',
    });
  });

  it("decodes a view column that names a table column under an alias", () => {
    store = createBunSqliteStore();
    store.exec(
      "create table holds (id text primary key, held_at timestamptz not null, worked boolean not null)",
      [],
    );
    store.exec(
      `create view hold_summary as
       with ranked as (select *, row_number() over (order by held_at) as rank from holds)
       select held_at as derived_at, worked as is_done, count(*) as n
         from ranked group by held_at, worked`,
      [],
    );
    store.exec(
      "insert into holds values ('a', '2026-11-18T12:00:00.000Z', 1)",
      [],
    );
    const decode = createRowDecoder(readColumnKinds(store));

    const rows = store
      .exec("select * from hold_summary", [])
      .rows.map((row) => decode(row));

    expect(rows).toEqual([
      { derived_at: new Date("2026-11-18T12:00:00.000Z"), is_done: true, n: 1 },
    ]);
  });

  it("refuses a column name declared as two kinds", () => {
    store = createBunSqliteStore();
    store.exec("create table a (required boolean)", []);
    store.exec("create table b (required json)", []);

    expect(() => readColumnKinds(store)).toThrow(
      "sqlite_column_kind_conflict: required is boolean in a and json in b",
    );
  });
});
