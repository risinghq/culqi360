import type {
  ActivityRowView,
  ProductionReportView,
  ReportFiltersView,
} from "~/contracts/reports/views";
import { ACTIVITY_CHANNELS } from "~/domain/activities/channel";
import {
  hasPermission,
  type PermissionHolder,
} from "~/domain/auth/access/rbac";
import {
  ActivityOutcomeId,
  CaseTypeId,
  UserId,
  type BranchId,
} from "~/domain/ids";
import { getApplication } from "~/server/composition/application";
import { executeSessionServerFunction } from "~/server/platform/action";
import {
  parseObject,
  validationFail,
} from "~/server/platform/action/input-reader";
import { Ok } from "~/shared/result";

import type { ActivityQuery } from "../application/activity-report";
import type { ProductionQuery } from "../application/production-report";
import type { ReportReach } from "../infrastructure/reports-repo";

type ReportActor = PermissionHolder & { userId: UserId; branchId: BranchId };

export function reachOf(actor: ReportActor): ReportReach {
  if (hasPermission(actor, "report:view:all")) {
    return { kind: "all" };
  }
  if (hasPermission(actor, "report:view:branch")) {
    return { kind: "branch", branchId: actor.branchId };
  }
  return { kind: "own", userId: actor.userId };
}

function parseProduction(input: unknown) {
  return parseObject(input, validationFail, (r) => ({
    caseTypeId: r.id("caseTypeId", CaseTypeId),
    stageKey: r.str("stageKey", { min: 1, max: 80 }),
    sumFieldKey: r.optStr("sumFieldKey"),
    month: r.calendarMonth("month"),
  }));
}

function parseActivity(input: unknown) {
  return parseObject(input, validationFail, (r) => ({
    from: r.calendarDate("from"),
    to: r.calendarDate("to"),
    userId: r.optId("userId", UserId) ?? null,
    channel: r.optEnum("channel", ACTIVITY_CHANNELS) ?? null,
    outcomeId: r.optId("outcomeId", ActivityOutcomeId) ?? null,
  }));
}

export async function getReportFilters(): Promise<ReportFiltersView> {
  return executeSessionServerFunction({
    name: "reports.filters",
    access: { kind: "permission", permission: "report:read" },
    execute: async (ctx) => {
      const reports = getApplication().reports;
      const reach = reachOf(ctx.actor);
      const [caseTypes, users, outcomes] = await Promise.all([
        reports.caseTypes(),
        reports.users(reach),
        reports.outcomes(),
      ]);
      return Ok({
        reach: reach.kind,
        caseTypes: caseTypes.map(({ id, definition }) => ({
          id,
          name: definition.name,
          stages: definition.stages.map(({ key, name }) => ({ key, name })),
          numberFields: definition.fields
            .filter((field) => field.kind === "number")
            .map(({ key, label }) => ({ key, label })),
        })),
        users,
        outcomes,
      });
    },
  });
}

export async function getProductionReport(
  input: unknown,
): Promise<ProductionReportView> {
  return executeSessionServerFunction({
    name: "reports.production",
    access: { kind: "permission", permission: "report:read" },
    parse: () => parseProduction(input),
    execute: async (ctx, query) => {
      const report = await getApplication().reports.production({
        ...query,
        reach: reachOf(ctx.actor),
      } satisfies ProductionQuery);
      if (!report.ok) {
        return report;
      }
      const { statuses, rows, totals, sumLabel } = report.value;
      return Ok({
        statuses: statuses.map((status) => status.label),
        rows,
        totals,
        sumLabel,
      });
    },
  });
}

export async function getActivityReport(
  input: unknown,
): Promise<ActivityRowView[]> {
  return executeSessionServerFunction({
    name: "reports.activity",
    access: { kind: "permission", permission: "report:read" },
    parse: () => parseActivity(input),
    execute: async (ctx, query) => {
      const rows = await getApplication().reports.activities({
        ...query,
        reach: reachOf(ctx.actor),
      } satisfies ActivityQuery);
      if (!rows.ok) {
        return rows;
      }
      return Ok(
        rows.value.map((row) => ({
          startedAt: row.startedAt.getTime(),
          channel: row.channel,
          userName: row.userName,
          ruc: row.ruc,
          legalName: row.legalName,
          contactName: row.contactName,
          subject: row.subject,
          outcomeLabel: row.outcomeLabel,
          durationSeconds: row.durationSeconds,
        })),
      );
    },
  });
}

export async function requestProductionExport(input: unknown) {
  return executeSessionServerFunction({
    name: "reports.production.export",
    access: { kind: "permission", permission: "report:read" },
    parse: () => parseProduction(input),
    telemetry: ({ caseTypeId, month }) => ({ caseTypeId, month }),
    execute: (ctx, query) =>
      getApplication().reports.exportProduction(ctx, {
        ...query,
        reach: reachOf(ctx.actor),
      }),
  });
}

export async function requestActivityExport(input: unknown) {
  return executeSessionServerFunction({
    name: "reports.activity.export",
    access: { kind: "permission", permission: "report:read" },
    parse: () => parseActivity(input),
    telemetry: ({ from, to }) => ({ from, to }),
    execute: (ctx, query) =>
      getApplication().reports.exportActivities(ctx, {
        ...query,
        reach: reachOf(ctx.actor),
      }),
  });
}
