// A migration is plain SQL with no parameters, so reference rows from code
// constants are written as quoted literals.
export function quote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function insertValues(
  table: string,
  column: string,
  values: readonly string[],
): string {
  return `insert into ${table} (${column}) values ${values.map((value) => `(${quote(value)})`).join(", ")}`;
}

// A seeded row's timestamps say it was there from the start.
export const EPOCH = quote(new Date(0).toISOString());
