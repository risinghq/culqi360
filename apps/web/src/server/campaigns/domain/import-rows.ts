import { fail, type DomainError } from "~/domain/errors";
import { parseRuc, type Ruc } from "~/domain/identity/document";

// safeapp hands out 30 companies per draw. Small enough that an executive
// works the whole batch in a shift, so released records stay rare.
export const CAMPAIGN_BATCH_SIZE = 30;

export type CampaignImportRow = {
  line: number;
  ruc: unknown;
  legalName: unknown;
  segment: unknown;
  facts: Readonly<Record<string, unknown>>;
};

export type CampaignRecordInput = {
  ruc: Ruc;
  legalName: string | null;
  segment: string;
  facts: Record<string, string>;
};

export type RejectedRow = {
  line: number;
  error: DomainError;
};

export type CheckedRows = {
  records: CampaignRecordInput[];
  rejected: RejectedRow[];
};

function text(value: unknown): string | null {
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

// A file may list a company twice in one segment. The later line wins, as it
// would if the rows were imported one after another.
export function checkImportRows(
  rows: readonly CampaignImportRow[],
): CheckedRows {
  const byKey = new Map<string, CampaignRecordInput>();
  const rejected: RejectedRow[] = [];
  for (const row of rows) {
    const ruc = parseRuc(text(row.ruc));
    if (!ruc.ok) {
      rejected.push({ line: row.line, error: ruc.error });
      continue;
    }
    const segment = text(row.segment);
    if (segment === null) {
      rejected.push({
        line: row.line,
        error: fail("campaign_segment_missing"),
      });
      continue;
    }
    const facts: Record<string, string> = {};
    for (const [key, value] of Object.entries(row.facts)) {
      const fact = text(value);
      if (fact !== null) {
        facts[key] = fact;
      }
    }
    const key = `${ruc.value}\u0000${segment}`;
    byKey.delete(key);
    byKey.set(key, {
      ruc: ruc.value,
      legalName: text(row.legalName),
      segment,
      facts,
    });
  }
  return { records: [...byKey.values()], rejected };
}
