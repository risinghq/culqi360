import type { CommissionManagerView } from "~/contracts/merchant-stats/commission-views";
import type {
  BookFilter,
  CohortSaleRow,
  FilterOptions,
  GpvCulqiView,
  GpvPerformanceView,
  Page,
  PublishedPage,
  QualityRow,
} from "~/contracts/merchant-stats/views";
import type { QualityIssue } from "~/contracts/merchant-stats/vocabulary";
import type { DomainError } from "~/domain/errors";
import type { GpvSnapshotId, GpvSnapshotIssueId, UserId } from "~/domain/ids";
import type { CommissionSchemeRules } from "~/domain/merchant-stats/commission";
import type { GpvSnapshotIssueResolution } from "~/domain/merchant-stats/snapshot";
import { appCalendarDateAt } from "~/domain/time/app-time";
import type { WorkspaceExecutor } from "~/server/platform/database/executor";
import type { OperationContext } from "~/server/platform/operation/context";
import type { Result } from "~/shared/result";
import type { TableBody } from "~/shared/table";

import {
  setCommissionScheme,
  type SetCommissionSchemeInput,
} from "../commands/set-commission-scheme";
import { setTarget, type SetTargetInput } from "../commands/set-target";
import { getCommissionSchemeAsOf } from "../commission/scheme-repo";
import { getCommissionManagerView } from "../commission/ui/manager-view";
import {
  adjustMerchantMonthCredit,
  type AdjustMerchantMonthCreditInput,
} from "../credit/adjust";
import { exportMerchantGpv } from "../export/export-gpv";
import { getCohortRows } from "../read/cohort";
import {
  getGpvCulqiView,
  getGpvPerformanceView,
} from "../read/dashboard-views";
import { loadExecutiveGpvProgress } from "../read/executive-portfolio";
import { getFilterOptions } from "../read/options";
import { readPublishedGpvPage } from "../read/published-page";
import { getQualityRows } from "../read/quality";
import { getMerchantStatsForViewer } from "../read/ruc-stats";
import { getGpvSnapshotDetail } from "../read/snapshot-detail";
import { closeGpvImport } from "../snapshot/close";
import { openGpvImport } from "../snapshot/open";
import { resolveGpvSnapshotIssue } from "../snapshot/resolve-issue";
import { stageGpvLines } from "../snapshot/stage";

interface MerchantStatsRuntimeDeps {
  db: WorkspaceExecutor;
}

export function createMerchantStatsRuntime(deps: MerchantStatsRuntimeDeps) {
  return {
    dashboard: {
      performance: (
        filter: BookFilter,
        operation: OperationContext,
      ): Promise<GpvPerformanceView> =>
        getGpvPerformanceView(deps.db, filter, operation),
      culqi: (filter: BookFilter): Promise<GpvCulqiView> =>
        getGpvCulqiView(deps.db, filter),
      cohorts: (
        filter: BookFilter,
        page: Page,
      ): Promise<PublishedPage<CohortSaleRow>> =>
        readPublishedGpvPage(deps.db, (transaction) =>
          getCohortRows(transaction, filter, page),
        ),
      filterOptions: (): Promise<FilterOptions> => getFilterOptions(deps.db),
      export: (filter: BookFilter, at: Date) =>
        exportMerchantGpv(deps.db, filter, at),
    },
    executive: {
      progress: (userId: UserId, operation: OperationContext) =>
        loadExecutiveGpvProgress(deps.db, userId, operation),
      rucStats: getMerchantStatsForViewer.bind(null, deps.db),
    },
    quality: {
      rows: (
        issue: QualityIssue,
        page: Page,
      ): Promise<PublishedPage<QualityRow>> =>
        readPublishedGpvPage(deps.db, (transaction) =>
          getQualityRows(transaction, issue, page),
        ),
    },
    attribution: {
      adjust: (
        input: Omit<AdjustMerchantMonthCreditInput, "operation">,
        operation: OperationContext,
      ): Promise<Result<void, DomainError>> =>
        adjustMerchantMonthCredit(deps.db, { ...input, operation }),
      setTarget: (
        input: Omit<SetTargetInput, "operation">,
        operation: OperationContext,
      ): Promise<Result<void, DomainError>> =>
        setTarget(deps.db, { ...input, operation }),
    },
    commission: {
      getScheme: (
        operation: OperationContext,
      ): Promise<CommissionSchemeRules> =>
        getCommissionSchemeAsOf(
          deps.db,
          appCalendarDateAt(operation.operationAt),
        ),
      setScheme: (
        input: Omit<SetCommissionSchemeInput, "operation">,
        operation: OperationContext,
      ): Promise<Result<void, DomainError>> =>
        setCommissionScheme(deps.db, { ...input, operation }),
      managerView: (
        operation: OperationContext,
      ): Promise<CommissionManagerView> =>
        getCommissionManagerView(deps.db, operation),
    },
    imports: {
      open: (
        input: { contentSha256: string; cutAt: Date; uploadedBy: UserId },
        operation: OperationContext,
      ) =>
        openGpvImport(deps.db, {
          ...input,
          uploadedAt: operation.operationAt,
        }),
      stage: (
        input: { snapshotId: GpvSnapshotId; table: TableBody },
        operation: OperationContext,
      ) =>
        stageGpvLines(deps.db, {
          ...input,
          stagedAt: operation.operationAt,
        }),
      close: (snapshotId: GpvSnapshotId, operation: OperationContext) =>
        closeGpvImport(deps.db, {
          snapshotId,
          closedAt: operation.operationAt,
        }),
      snapshot: (snapshotId: GpvSnapshotId) =>
        getGpvSnapshotDetail(deps.db, snapshotId),
      resolveIssue: (
        input: {
          issueId: GpvSnapshotIssueId;
          resolution: GpvSnapshotIssueResolution;
          resolvedBy: UserId;
        },
        operation: OperationContext,
      ) => resolveGpvSnapshotIssue(deps.db, { ...input, operation }),
    },
  };
}
