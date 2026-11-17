import type { SQL } from "bun";

// The safeapp tables the cutover reads.
export const SOURCE_TABLES = [
  "tienda",
  "usuario",
  "rol",
  "acceso",
  "menu",
  "asignacion_tienda",
  "cliente",
  "cartera",
  "producto",
  "nc_movil",
  "nc_fija",
  "quiebre",
  "datos",
  "asignacion_datos",
  "respuesta",
  "llamada",
] as const;

export type SourceTable = (typeof SOURCE_TABLES)[number];

// Every column arrives as text or null. MariaDB formats dates, decimals and
// ids itself, so no driver time zone or float conversion touches a value.
export type SourceRow = Readonly<Record<string, string | null>>;

export type SafeappSnapshot = Readonly<
  Record<SourceTable, readonly SourceRow[]>
>;

const quote = (identifier: string) => `\`${identifier.replaceAll("`", "``")}\``;

function toSourceRow(row: Record<string, unknown>): SourceRow {
  return Object.fromEntries(
    Object.entries(row).map(([column, value]) => [
      column,
      typeof value === "string" ? value : null,
    ]),
  );
}

async function readTable(
  connection: SQL,
  table: SourceTable,
): Promise<SourceRow[]> {
  const columns: { name: string }[] = await connection.unsafe(
    "select column_name as name from information_schema.columns where table_schema = database() and table_name = ? order by ordinal_position",
    [table],
  );
  if (columns.length === 0) {
    throw new Error(`safeapp_table_missing:${table}`);
  }
  const list = columns
    .map(({ name }) => `cast(${quote(name)} as char) as ${quote(name)}`)
    .join(", ");
  const rows: Record<string, unknown>[] = await connection.unsafe(
    `select ${list} from ${quote(table)}`,
  );
  return rows.map(toSourceRow);
}

// Reads every table in one read-only snapshot, so a source still in use gives
// a consistent copy.
export async function readSafeappSnapshot(
  source: SQL,
): Promise<SafeappSnapshot> {
  const connection = await source.reserve();
  try {
    await connection.unsafe(
      "start transaction with consistent snapshot, read only",
    );
    const snapshot: Record<SourceTable, readonly SourceRow[]> = {
      tienda: [],
      usuario: [],
      rol: [],
      acceso: [],
      menu: [],
      asignacion_tienda: [],
      cliente: [],
      cartera: [],
      producto: [],
      nc_movil: [],
      nc_fija: [],
      quiebre: [],
      datos: [],
      asignacion_datos: [],
      respuesta: [],
      llamada: [],
    };
    // One connection holds the snapshot, so the reads run in turn.
    for (const table of SOURCE_TABLES) {
      // eslint-disable-next-line no-await-in-loop
      snapshot[table] = await readTable(connection, table);
    }
    await connection.unsafe("commit");
    return snapshot;
  } finally {
    void connection.release();
  }
}
