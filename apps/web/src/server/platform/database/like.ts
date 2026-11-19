import { type Expression, type RawBuilder, sql, type SqlBool } from "kysely";

// SQLite LIKE folds ASCII case only and has no escape character unless the
// query names one, so the text's own wildcards are escaped here.
export function containsText(
  column: Expression<unknown>,
  text: string,
): RawBuilder<SqlBool> {
  const pattern = `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
  return sql<SqlBool>`${column} like ${pattern} escape '\\'`;
}
