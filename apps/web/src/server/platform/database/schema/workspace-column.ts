import { sql, type CreateTableBuilder } from "kysely";

import { WORKSPACE_SETTING } from "../workspace-scope";

// Rows written inside a workspace scope take that workspace without the
// caller naming it. The setting is empty outside a workspace scope, so an
// owned row written there fails the not-null check instead of landing in no
// workspace.
const scopeWorkspace = sql`nullif(current_setting(${sql.lit(WORKSPACE_SETTING)}, true), '')::uuid`;

// The tenancy module adds row-level security to every table with this column.
export function workspaceOwned<TTable extends string, TColumns extends string>(
  table: CreateTableBuilder<TTable, TColumns>,
): CreateTableBuilder<TTable, TColumns | "workspace_id"> {
  return table.addColumn("workspace_id", "uuid", (col) =>
    col.notNull().references("workspaces.id").defaultTo(scopeWorkspace),
  );
}

// For tables that also hold platform rows, such as anonymous auth events.
// A null workspace row is visible only at platform scope.
export function workspaceTagged<TTable extends string, TColumns extends string>(
  table: CreateTableBuilder<TTable, TColumns>,
): CreateTableBuilder<TTable, TColumns | "workspace_id"> {
  return table.addColumn("workspace_id", "uuid", (col) =>
    col.references("workspaces.id").defaultTo(scopeWorkspace),
  );
}

export { scopeWorkspace };
