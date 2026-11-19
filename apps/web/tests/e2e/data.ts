import { Database, type SQLQueryBindings } from "bun:sqlite";
import { cpSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

import { INSTALLATION_WORKSPACE_ID } from "~/server/platform/database/seeds/installation/workspace-id";
import { workspaceStoreName } from "~/server/platform/database/store";

// globalSetup builds the template once; each Playwright worker copies it and
// runs its own server over the copy.
export const E2E_DATA_ROOT = resolve(process.cwd(), ".e2e-data");
export const TEMPLATE_DIR = join(E2E_DATA_ROOT, "template");
export const SERVER_ENTRY = resolve(process.cwd(), "server.ts");

function storeFiles(dataDir: string): string[] {
  return readdirSync(dataDir, { recursive: true, encoding: "utf8" }).filter(
    (path) => path.endsWith(".sqlite"),
  );
}

// One worker store file, restored to its template between tests. The server
// writes through its own connection, so `data_version` moves on each of its
// commits; this connection's own writes mark the store dirty instead.
class RestorableStore {
  private readonly statements: string[];
  private seenVersion: number;
  private dirty = false;

  constructor(
    private readonly db: Database,
    templatePath: string,
  ) {
    db.exec("pragma busy_timeout = 5000");
    db.run("attach database ? as template", [templatePath]);
    this.statements = restoreStatements(db);
    this.seenVersion = this.dataVersion();
  }

  run(sql: string, ...bindings: SQLQueryBindings[]): void {
    this.db.run(sql, bindings);
    this.dirty = true;
  }

  // Foreign keys stay off on this connection, so tables restore in any order.
  // Deleting and inserting base rows fires the FTS triggers, which keep each
  // search index in step.
  restore(): void {
    if (!this.dirty && this.dataVersion() === this.seenVersion) {
      return;
    }
    this.db.transaction(() => {
      for (const statement of this.statements) {
        this.db.exec(statement);
      }
    })();
    this.dirty = false;
    this.seenVersion = this.dataVersion();
  }

  close(): void {
    this.db.close();
  }

  private dataVersion(): number {
    const row = this.db
      .query<{ data_version: number }, []>("pragma data_version")
      .get();
    if (!row) {
      throw new Error("sqlite_returned_no_data_version");
    }
    return row.data_version;
  }
}

// A delete and a copy for each ordinary table and sqlite_sequence. Virtual
// tables and their shadow tables follow through the base tables' triggers.
// `table_info` leaves out generated columns, which cannot be inserted.
function restoreStatements(db: Database): string[] {
  const tables = db
    .query<{ name: string; type: string }, []>("pragma template.table_list")
    .all()
    .filter(
      ({ name, type }) =>
        type === "table" &&
        (!name.startsWith("sqlite_") || name === "sqlite_sequence"),
    )
    .map(({ name }) => name);

  return tables.flatMap((table) => {
    const columns = db
      .query<{ name: string }, [string]>(
        "select name from pragma_table_info(?, 'template')",
      )
      .all(table)
      .map(({ name }) => `"${name}"`)
      .join(", ");
    return [
      `delete from main."${table}"`,
      `insert into main."${table}" (${columns}) select ${columns} from template."${table}"`,
    ];
  });
}

export class WorkerData {
  private constructor(
    readonly dir: string,
    private readonly stores: Map<string, RestorableStore>,
    // The installation workspace's store, for a test that seeds a row the UI
    // cannot create.
    readonly workspace: Pick<RestorableStore, "run">,
  ) {}

  static open(name: string): WorkerData {
    if (!existsSync(TEMPLATE_DIR)) {
      throw new Error(
        `no e2e template at ${TEMPLATE_DIR}; run e2e tests via 'bun run test:e2e' so globalSetup builds it first`,
      );
    }
    const dir = join(E2E_DATA_ROOT, name);
    rmSync(dir, { recursive: true, force: true });
    cpSync(TEMPLATE_DIR, dir, { recursive: true });

    const stores = new Map<string, RestorableStore>();
    for (const file of storeFiles(dir)) {
      stores.set(
        file,
        new RestorableStore(
          new Database(join(dir, file)),
          join(TEMPLATE_DIR, file),
        ),
      );
    }
    const file = `${workspaceStoreName(INSTALLATION_WORKSPACE_ID)}.sqlite`;
    const workspace = stores.get(file);
    if (!workspace) {
      throw new Error(`no ${file} in ${dir}`);
    }
    return new WorkerData(dir, stores, workspace);
  }

  reset(): void {
    for (const store of this.stores.values()) {
      store.restore();
    }
  }

  close(): void {
    for (const store of this.stores.values()) {
      store.close();
    }
    rmSync(this.dir, { recursive: true, force: true });
  }
}
