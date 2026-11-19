import { afterEach, describe, expect, it } from "vitest";

import { createBunSqliteStore } from "~/server/platform/database/bun-store";
import { readColumnKinds } from "~/server/platform/database/codec";
import { applyMigrations } from "~/server/platform/database/migrate";
import { PLATFORM_MIGRATIONS } from "~/server/platform/database/schema/platform";
import { REGISTRY_MIGRATIONS } from "~/server/platform/database/schema/registry";
import { WORKSPACE_MIGRATIONS } from "~/server/platform/database/schema/workspace";

const STORES = [
  ["platform", PLATFORM_MIGRATIONS],
  ["workspace", WORKSPACE_MIGRATIONS],
  ["registry", REGISTRY_MIGRATIONS],
] as const;

describe.each(STORES)("%s schema", (_name, migrations) => {
  let store: ReturnType<typeof createBunSqliteStore>;

  afterEach(() => {
    store.close();
  });

  it("applies once and gives each column name one kind", async () => {
    store = createBunSqliteStore();
    await applyMigrations(store, migrations);
    const tables = () =>
      store.exec("select count(*) as n from sqlite_schema", []).rows[0]?.n;
    const before = tables();

    await applyMigrations(store, migrations);

    expect(tables()).toBe(before);
    expect(() => readColumnKinds(store)).not.toThrow();
    expect(store.exec("pragma foreign_key_check", []).rows).toEqual([]);
  });

  // SQLite lets a rowid table store null in a primary key column unless the
  // column says not null, so a missing id would insert instead of failing.
  // An integer primary key is the rowid itself and fills a null in.
  it("refuses null in every primary key column", async () => {
    store = createBunSqliteStore();
    await applyMigrations(store, migrations);

    const nullable = store.exec(
      `select m.name || '.' || p.name as key_column
         from sqlite_schema m join pragma_table_info(m.name) p
        where m.type = 'table' and p.pk > 0 and p."notnull" = 0
          and lower(p.type) != 'integer'
          and m.name not like 'sqlite_%' and m.name not like '%search%'`,
      [],
    ).rows;

    expect(nullable).toEqual([]);
  });
});

describe("platform accounts", () => {
  let store: ReturnType<typeof createBunSqliteStore>;
  const now = "2026-11-18T00:00:00.000Z";

  afterEach(() => {
    store.close();
  });

  async function seed() {
    store = createBunSqliteStore();
    await applyMigrations(store, PLATFORM_MIGRATIONS);
    store.exec(
      `insert into accounts (id, username, email, password_hash, names,
         first_surname, second_surname, created_at)
       values ('a1', 'ana', 'ana@example.com', 'h', 'Ana', 'Ruiz', 'Paz', ?)`,
      [now],
    );
  }

  it("treats emails that differ only in case as one", async () => {
    await seed();

    expect(() =>
      store.exec(
        `insert into accounts (id, username, email, password_hash, names,
           first_surname, second_surname, created_at)
         values ('a2', 'ana2', 'ANA@example.com', 'h', 'Ana', 'Ruiz', 'Paz', ?)`,
        [now],
      ),
    ).toThrow(/UNIQUE/);
  });
});

describe("workspace sessions", () => {
  let store: ReturnType<typeof createBunSqliteStore>;
  const now = "2026-11-18T00:00:00.000Z";

  afterEach(() => {
    store.close();
  });

  it("refuses a session for someone who is not a member", async () => {
    store = createBunSqliteStore();
    await applyMigrations(store, WORKSPACE_MIGRATIONS);

    expect(() =>
      store.exec(
        `insert into user_sessions (id, user_id, session_class,
           primary_auth_method, ip_address, created_at, last_activity,
           expires_at)
         values ('x', 'not-a-member', 'app', 'password', '127.0.0.1', ?, ?, ?)`,
        [now, now, now],
      ),
    ).toThrow(/FOREIGN KEY/);
  });
});

describe("workspace store queries", () => {
  let store: ReturnType<typeof createBunSqliteStore>;
  const now = "2026-11-18T00:00:00.000Z";

  afterEach(() => {
    store.close();
  });

  // These tests read what the views and the search index compute; the rows
  // they reference elsewhere do not change that.
  async function open() {
    store = createBunSqliteStore();
    await applyMigrations(store, WORKSPACE_MIGRATIONS);
    store.exec("pragma foreign_keys = off", []);
  }

  const rows = (sql: string) => store.exec(sql, []).rows;

  it("finds a company by part of its current legal name", async () => {
    await open();
    store.exec(
      `insert into organizations (id, ruc, legal_name, created_at)
       values ('o1', '20100000001', 'Bodega San Martin', ?),
              ('o2', '20100000002', 'Ferreteria Lima', ?)`,
      [now, now],
    );
    store.exec(
      `update organizations set legal_name = 'Bodega Santa Rosa' where id = 'o1'`,
      [],
    );
    const search = (term: string) =>
      store.exec(
        `select id from organizations
          where seq in (select rowid from organizations_search where legal_name like ?)
          order by id`,
        [`%${term}%`],
      ).rows;

    expect(search("santa ro")).toEqual([{ id: "o1" }]);
    expect(search("san mar")).toEqual([]);
    expect(search("lima")).toEqual([{ id: "o2" }]);
  });

  it("dates each observation by its sale month plus the offset", async () => {
    await open();
    store.exec(
      `insert into gpv_snapshot_observations
         (snapshot_id, placement_id, month_offset, sale_month, gpv, trx)
       values ('s1', 'p1', 0, '2026-11-01', 10, 1), ('s1', 'p1', 3, '2026-11-01', 20, 2)`,
      [],
    );

    expect(
      rows(
        "select month_offset, realized_month from gpv_snapshot_observations order by month_offset",
      ),
    ).toEqual([
      { month_offset: 0, realized_month: "2026-11-01" },
      { month_offset: 3, realized_month: "2027-02-01" },
    ]);
  });

  it("credits a merchant month to the latest adjustment, else to the owner", async () => {
    await open();
    store.exec(
      `insert into merchant_month_credits
         (ruc, month, organization_id, seller_user_id, branch_id, first_snapshot_id, credited_at)
       values ('20100000001', '2026-10-01', 'o1', 'owner', 'b1', 's1', ?),
              ('20100000002', '2026-10-01', 'o2', 'owner', 'b1', 's1', ?)`,
      [now, now],
    );
    store.exec(
      `insert into merchant_month_credit_adjustments
         (id, ruc, month, seller_user_id, branch_id, reason, adjusted_by, adjusted_at)
       values ('j1', '20100000001', '2026-10-01', 'first', 'b2', 'r', 'admin', '2026-11-01T00:00:00.000Z'),
              ('j2', '20100000001', '2026-10-01', null, null, 'r', 'admin', '2026-11-02T00:00:00.000Z')`,
      [],
    );

    expect(
      rows(
        `select ruc, seller_user_id, branch_id, method, confidence, first_snapshot_id, resolved_at
           from merchant_month_credit order by ruc`,
      ),
    ).toEqual([
      {
        ruc: "20100000001",
        seller_user_id: null,
        branch_id: null,
        method: "manual",
        confidence: "none",
        first_snapshot_id: "s1",
        resolved_at: "2026-11-02T00:00:00.000Z",
      },
      {
        ruc: "20100000002",
        seller_user_id: "owner",
        branch_id: "b1",
        method: "crm_owner",
        confidence: "exact",
        first_snapshot_id: "s1",
        resolved_at: null,
      },
    ]);
  });
});
