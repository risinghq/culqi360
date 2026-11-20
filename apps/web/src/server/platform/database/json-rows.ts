import { sql, type RawBuilder } from "kysely";

/** Selects `rows` back out of one JSON parameter, one column per name, so
 * an `INSERT ... SELECT` writes any number of rows with a single binding.
 *
 * `->>` yields what the driver binds for the same value: ISO text for a
 * Date, 1 or 0 for a boolean, JSON text for an object or array. A bigint
 * cannot pass through JSON. The `where true` lets SQLite parse an upsert's
 * `on conflict` after a `select ... from`. */
export function selectJsonRows<Column extends string>(
  rows: readonly Readonly<Record<Column, unknown>>[],
  columns: readonly Column[],
): RawBuilder<Record<Column, unknown>> {
  const values = sql.join(
    columns.map(
      (column) =>
        sql`source.value ->> ${sql.lit(column)} as ${sql.ref(column)}`,
    ),
  );
  return sql`select ${values} from json_each(${JSON.stringify(rows)}) as "source" where true`;
}
