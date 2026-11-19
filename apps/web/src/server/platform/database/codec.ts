import {
  AggregateFunctionNode,
  ColumnNode,
  DeleteQueryNode,
  FunctionNode,
  IdentifierNode,
  InsertQueryNode,
  type OperationNode,
  ReferenceNode,
  type RootOperationNode,
  SelectQueryNode,
  type SelectionNode,
  UpdateQueryNode,
} from "kysely";

import type { RowDecoder } from "./driver";
import type { SqliteStore } from "./store";

// What a stored value turns back into. SQLite keeps each column's declared
// type name as written, so the DDL is the only place a column's kind is set.
export type ColumnKind = "timestamp" | "boolean" | "json" | "plain";

export function kindOfDeclaredType(declared: string): ColumnKind {
  switch (declared.toLowerCase()) {
    case "timestamptz":
      return "timestamp";
    case "boolean":
      return "boolean";
    case "json":
      return "json";
    default:
      return "plain";
  }
}

// Rows come back keyed by column name, not by table, so a name means one kind
// in every table and view. A clash fails here, before any row is read wrongly.
// A view column carries a declared type only when it names a table column,
// directly or under an alias; an expression column has none and is skipped.
export function readColumnKinds(store: SqliteStore): Map<string, ColumnKind> {
  const { rows } = store.exec(
    `select m.name as table_name, p.name as column_name, p.type as declared
       from sqlite_schema m join pragma_table_info(m.name) p
      where m.type in ('table', 'view')
        and p.type != ''
        and m.name not like 'sqlite_%'
        and m.name not like '_cf_%'`,
    [],
  );

  const kinds = new Map<string, ColumnKind>();
  const seenIn = new Map<string, string>();
  for (const row of rows) {
    const column = String(row.column_name);
    const table = String(row.table_name);
    const kind = kindOfDeclaredType(String(row.declared));
    const known = kinds.get(column);
    if (known !== undefined && known !== kind) {
      throw new Error(
        `sqlite_column_kind_conflict: ${column} is ${known} in ${seenIn.get(column)} and ${kind} in ${table}`,
      );
    }
    kinds.set(column, kind);
    seenIn.set(column, table);
  }
  return kinds;
}

function decodeValue(kind: ColumnKind, value: unknown): unknown {
  if (value === null || kind === "plain") {
    return value;
  }
  if (kind === "timestamp") {
    // Timestamps are stored as ISO-8601 text.
    return typeof value === "string" ? new Date(value) : value;
  }
  if (kind === "boolean") {
    return value === 1;
  }
  // `json` has numeric affinity, so a bare JSON number is stored as a number.
  return typeof value === "string" ? JSON.parse(value) : value;
}

// `sources` maps each aliased output name to the schema column it selects, or
// to null for an expression. So `held_at as heldAt` decodes as held_at, and a
// raw `json_group_object(...) as statuses` stays text even though a table has
// a json column named statuses. Expressions pass through as SQLite returned
// them.
export function createRowDecoder(kinds: Map<string, ColumnKind>): RowDecoder {
  return (row, sources) => {
    const decoded: Record<string, unknown> = {};
    for (const [column, value] of Object.entries(row)) {
      const source = sources?.has(column) ? sources.get(column) : column;
      const kind = source == null ? undefined : kinds.get(source);
      decoded[column] = kind === undefined ? value : decodeValue(kind, value);
    }
    return decoded;
  };
}

// These return one of their arguments unchanged, so the result keeps the
// first argument's column kind.
const KIND_PRESERVING_FUNCTIONS = new Set(["max", "min", "coalesce", "ifnull"]);

// A Durable Object cursor reports no declared types, so the query tree is the
// only place an alias can be traced back to its column.
export function selectionSources(
  query: RootOperationNode,
): Map<string, string | null> {
  const sources = new Map<string, string | null>();
  for (const selection of selectionsOf(query)) {
    const child = selection.selection;
    if (child.kind === "AliasNode" && IdentifierNode.is(child.alias)) {
      sources.set(child.alias.name, sourceColumn(child.node));
    }
  }
  return sources;
}

function selectionsOf(query: RootOperationNode): readonly SelectionNode[] {
  if (SelectQueryNode.is(query)) {
    return query.selections ?? [];
  }
  if (
    InsertQueryNode.is(query) ||
    UpdateQueryNode.is(query) ||
    DeleteQueryNode.is(query)
  ) {
    return query.returning?.selections ?? [];
  }
  return [];
}

function sourceColumn(node: OperationNode): string | null {
  if (ReferenceNode.is(node)) {
    return ColumnNode.is(node.column) ? node.column.column.name : null;
  }
  if (ColumnNode.is(node)) {
    return node.column.name;
  }
  if (FunctionNode.is(node) || AggregateFunctionNode.is(node)) {
    const args = FunctionNode.is(node) ? node.arguments : node.aggregated;
    const first = args[0];
    return KIND_PRESERVING_FUNCTIONS.has(node.func.toLowerCase()) && first
      ? sourceColumn(first)
      : null;
  }
  if (SelectQueryNode.is(node)) {
    const only = node.selections?.length === 1 ? node.selections[0] : undefined;
    if (!only) {
      return null;
    }
    const child = only.selection;
    return sourceColumn(child.kind === "AliasNode" ? child.node : child);
  }
  return null;
}
