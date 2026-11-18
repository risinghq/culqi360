import { fail, type DomainError } from "~/domain/errors";
import type { CaseTypeId, UserId } from "~/domain/ids";
import { appDayRange } from "~/domain/time/app-time";
import {
  addCalendarMonths,
  calendarMonthStart,
  type CalendarMonth,
} from "~/domain/time/calendar-date";
import type { StoredCaseType } from "~/server/cases/infrastructure/cases-repo";
import { Err, Ok, type Result } from "~/shared/result";

import type { ReportReach, ReportsRepo } from "../infrastructure/reports-repo";

export type ProductionQuery = {
  caseTypeId: CaseTypeId;
  stageKey: string;
  sumFieldKey: string | null;
  month: CalendarMonth;
  reach: ReportReach;
};

// A null status column counts the cases whose stage has not started.
export type ProductionStatus = { status: string | null; label: string };

export type ProductionRow = {
  holderUserId: UserId;
  holderName: string;
  counts: number[];
  total: number;
  sum: number | null;
};

export type ProductionReport = {
  caseTypeName: string;
  stageName: string;
  sumLabel: string | null;
  month: CalendarMonth;
  statuses: ProductionStatus[];
  rows: ProductionRow[];
  totals: Omit<ProductionRow, "holderUserId" | "holderName">;
};

export type ProductionDeps = {
  repo: Pick<ReportsRepo, "countProduction">;
  findCaseType: (id: CaseTypeId) => Promise<StoredCaseType | null>;
};

const NOT_STARTED = "Sin iniciar";

// Cases opened in the month, in app time, one row per holder. The columns
// follow the stage's statuses in definition order; a status the stage no
// longer lists still gets a column after them.
export async function buildProductionReport(
  deps: ProductionDeps,
  query: ProductionQuery,
): Promise<Result<ProductionReport, DomainError>> {
  const caseType = await deps.findCaseType(query.caseTypeId);
  if (!caseType) {
    return Err(fail("case_type_not_found"));
  }
  const { definition } = caseType;
  const stage = definition.stages.find((each) => each.key === query.stageKey);
  if (!stage) {
    return Err(fail("report_stage_not_found"));
  }
  const sumField =
    query.sumFieldKey === null
      ? null
      : definition.fields.find((field) => field.key === query.sumFieldKey);
  if (sumField !== null && sumField?.kind !== "number") {
    return Err(fail("report_sum_field_invalid"));
  }

  const counts = await deps.repo.countProduction({
    caseTypeId: query.caseTypeId,
    stageKey: stage.key,
    sumFieldKey: sumField?.key ?? null,
    opened: {
      start: appDayRange(calendarMonthStart(query.month)).start,
      endExclusive: appDayRange(
        calendarMonthStart(addCalendarMonths(query.month, 1)),
      ).start,
    },
    reach: query.reach,
  });

  const statuses = statusColumns(
    stage.statuses,
    counts.map((count) => count.status),
  );
  const rows = new Map<UserId, ProductionRow>();
  for (const count of counts) {
    const row = rows.get(count.holderUserId) ?? {
      holderUserId: count.holderUserId,
      holderName: count.holderName,
      counts: statuses.map(() => 0),
      total: 0,
      sum: null,
    };
    const column = statuses.findIndex(
      (status) => status.status === count.status,
    );
    row.counts[column] = (row.counts[column] ?? 0) + count.cases;
    row.total += count.cases;
    row.sum = addSum(row.sum, count.sum);
    rows.set(count.holderUserId, row);
  }
  const sorted = [...rows.values()].toSorted(
    (a, b) => b.total - a.total || a.holderName.localeCompare(b.holderName),
  );

  return Ok({
    caseTypeName: definition.name,
    stageName: stage.name,
    sumLabel: sumField?.label ?? null,
    month: query.month,
    statuses,
    rows: sorted,
    totals: {
      counts: statuses.map((_, column) =>
        sorted.reduce((total, row) => total + (row.counts[column] ?? 0), 0),
      ),
      total: sorted.reduce((total, row) => total + row.total, 0),
      sum: sorted.reduce<number | null>(
        (sum, row) => addSum(sum, row.sum),
        null,
      ),
    },
  });
}

function statusColumns(
  defined: readonly string[],
  found: readonly (string | null)[],
): ProductionStatus[] {
  const extra = [
    ...new Set(
      found.filter(
        (status): status is string =>
          status !== null && !defined.includes(status),
      ),
    ),
  ].toSorted();
  const columns: ProductionStatus[] = [...defined, ...extra].map((status) => ({
    status,
    label: status,
  }));
  if (found.includes(null)) {
    columns.push({ status: null, label: NOT_STARTED });
  }
  return columns;
}

function addSum(total: number | null, value: number | null): number | null {
  return value === null ? total : (total ?? 0) + value;
}
