import { SQL } from "bun";

// Every column arrives as text or null, so no driver time zone or float
// conversion touches a value.
export type SourceRow = Readonly<Record<string, string | null>>;

const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;

async function readTable(connection: SQL, table: string): Promise<SourceRow[]> {
  const columns: { name: string }[] = await connection.unsafe(
    "select column_name as name from information_schema.columns where table_schema = 'public' and table_name = $1 order by ordinal_position",
    [table],
  );
  if (columns.length === 0) {
    throw new Error(`cutover_table_missing:${table}`);
  }
  const list = columns
    .map(({ name }) => `${quote(name)}::text as ${quote(name)}`)
    .join(", ");
  const rows: Record<string, unknown>[] = await connection.unsafe(
    `select ${list} from ${quote(table)}`,
  );
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([column, value]) => [
        column,
        typeof value === "string" ? value : null,
      ]),
    ),
  );
}

// Reads the tables in one read-only snapshot, so a source still in use gives
// a consistent copy.
export async function readPostgresSnapshot<T extends string>(
  url: string,
  tables: readonly T[],
): Promise<Record<T, readonly SourceRow[]>> {
  const source = new SQL(url);
  const connection = await source.reserve();
  try {
    await connection.unsafe(
      "begin transaction isolation level repeatable read read only",
    );
    // The loop below fills every key.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const snapshot = {} as Record<T, readonly SourceRow[]>;
    // One connection holds the snapshot, so the reads run in turn.
    for (const table of tables) {
      // eslint-disable-next-line no-await-in-loop
      snapshot[table] = await readTable(connection, table);
    }
    await connection.unsafe("commit");
    return snapshot;
  } finally {
    void connection.release();
    await source.close();
  }
}
