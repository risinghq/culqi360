import {
  CompiledQuery,
  Kysely,
  PostgresDialect,
  type DatabaseConnection,
} from "kysely";
import { Pool, TypeOverrides, types } from "pg";

import { createLogger } from "~/shared/observability/runtime-logger";

import type { Database as DatabaseSchema } from "./types";
import {
  APP_ROLE,
  currentScope,
  WORKSPACE_SETTING,
  type DatabaseScope,
} from "./workspace-scope";

const logger = createLogger("db-client");

function createPoolTypes(): TypeOverrides {
  const poolTypes = new TypeOverrides();

  // Accept floating-point precision for `numeric` columns.
  poolTypes.setTypeParser(types.builtins.NUMERIC, Number.parseFloat);

  // `int8` values returned here must remain within Number.MAX_SAFE_INTEGER.
  poolTypes.setTypeParser(types.builtins.INT8, Number.parseInt);

  // Keep calendar dates timezone-neutral as `YYYY-MM-DD` strings.
  poolTypes.setTypeParser(types.builtins.DATE, (value) => value);

  return poolTypes;
}

function connectionTarget(connectionString: string) {
  try {
    const url = new URL(connectionString);

    return {
      protocol: url.protocol.replace(":", ""),
      host: url.hostname,
      port: url.port || null,
      database: url.pathname.replace(/^\//, "") || null,
    };
  } catch {
    return {
      protocol: "unknown",
      host: "unparseable",
      port: null,
      database: null,
    };
  }
}

// A reserved connection takes the role and workspace of the caller's scope.
// The last applied pair is remembered per connection, so a pooled connection
// that serves the same scope again costs no extra round trip. The settings are
// session-level and run before Kysely's BEGIN, so a rolled-back transaction
// does not undo them.
function createScopeBinder(resolveScope: () => DatabaseScope | undefined) {
  const applied = new WeakMap<DatabaseConnection, string>();

  return async (connection: DatabaseConnection): Promise<void> => {
    const scope = resolveScope();
    const role = scope?.kind === "platform" ? "none" : APP_ROLE;
    const workspaceId = scope?.kind === "workspace" ? scope.workspaceId : "";
    const key = `${role}/${workspaceId}`;

    if (applied.get(connection) === key) {
      return;
    }

    await connection.executeQuery(
      CompiledQuery.raw(
        "select set_config('role', $1, false), set_config($2, $3, false)",
        [role, WORKSPACE_SETTING, workspaceId],
      ),
    );
    applied.set(connection, key);
  };
}

// Resolve configuration lazily so importing database code does not require it.
export function createDb(
  resolveConnectionString: () => string,
  resolveScope: () => DatabaseScope | undefined = currentScope,
): Kysely<DatabaseSchema> {
  return new Kysely<DatabaseSchema>({
    dialect: new PostgresDialect({
      onReserveConnection: createScopeBinder(resolveScope),
      pool: async () => {
        const connectionString = resolveConnectionString();

        logger.info(
          "db_initialization_started",
          connectionTarget(connectionString),
        );

        return new Pool({
          connectionString,
          types: createPoolTypes(),
        });
      },
    }),
  });
}
