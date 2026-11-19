import type { Kysely } from "kysely";

import { createActivitiesRuntime } from "~/server/activities/runtime";
import { createAuditActionPoliciesRepo } from "~/server/audit-reader/audit-policy-repo";
import { createAuditPolicyService } from "~/server/audit-reader/policy-service";
import { workspaceCleanupDuty } from "~/server/auth/session/cleanup";
import { createCallsRuntime } from "~/server/calls/runtime";
import { createCampaignsRuntime } from "~/server/campaigns/runtime";
import { createCapacityRuntime } from "~/server/capacity/runtime";
import { caseTimeoutDuty } from "~/server/cases/case-timeout-maintenance";
import { createCasesRuntime } from "~/server/cases/runtime";
import type { CompanyRegistryClient } from "~/server/client-search/ports";
import { createEnrichmentProjector } from "~/server/client-search/realtime";
import { createClientSearchRuntime } from "~/server/client-search/runtime";
import { createCompaniesRuntime } from "~/server/companies/runtime";
import { createContactHoldsRuntime } from "~/server/contacts/runtime";
import { createIngestJobBridge } from "~/server/data-source-uploads/job-bridge";
import { createIngestJobProjector } from "~/server/data-source-uploads/realtime";
import { createDataSourceUploadsRuntime } from "~/server/data-source-uploads/runtime";
import {
  createEventLogsChannel,
  startEventLogsTail,
} from "~/server/event-logs/realtime";
import { createEventLogsService } from "~/server/event-logs/service";
import { createExtensionRuntime } from "~/server/extension/runtime";
import { createFilesRuntime } from "~/server/files/runtime";
import type { EngineClient } from "~/server/integrations/engine/client";
import { createIntegrationRuntime } from "~/server/integrations/infrastructure/runtime";
import { createInvitePlatform } from "~/server/invites/infrastructure/invite-platform";
import { createJobsChannel } from "~/server/jobs/channel";
import { createMerchantStatsRuntime } from "~/server/merchant-stats/infrastructure/runtime";
import { createGpvSnapshotProjector } from "~/server/merchant-stats/snapshot/realtime";
import type { MessagingGateway } from "~/server/notifications/channels/messaging-gateway";
import { createNotificationsRuntime } from "~/server/notifications/runtime";
import { createOrganizationEnrichmentProjection } from "~/server/organization/apply-enrichment";
import type { OrganizationEnrichment } from "~/server/organization/enrichment";
import { createOrganizationRepo } from "~/server/organization/organization-repo";
import type {
  appConfig,
  notificationsConfig,
  uploadsConfig,
} from "~/server/platform/config/env";
import type { PlatformDatabase } from "~/server/platform/database/types";
import type { WorkspaceInfrastructure } from "~/server/platform/infrastructure";
import { queueDuty } from "~/server/platform/jobs/job-queue";
import type { Duty } from "~/server/platform/schedule/schedule";
import { createRealtimeService } from "~/server/realtime/runtime";
import { createRecordImportProjector } from "~/server/records/imports/realtime";
import { createRecordImportsRuntime } from "~/server/records/imports/runtime";
import { createReportsRuntime } from "~/server/reports/runtime";
import { createRolesRuntime } from "~/server/roles/runtime";
import { createSearchRuntime } from "~/server/search/runtime";
import { createWorkspaceSessions } from "~/server/sessions/workspace-sessions";
import { createTeamRuntime } from "~/server/team/runtime";
import { accountLifecycleDuties } from "~/server/users/account-lifecycle-maintenance";
import type { AvatarService } from "~/server/users/avatar-service";
import { createMemberAccounts } from "~/server/users/infrastructure/member-accounts";
import { createMemberWriteContext } from "~/server/users/infrastructure/member-write-context";
import { createUsersRuntime } from "~/server/users/runtime";
import { leadReservationDuty } from "~/server/workflow/maintenance/lead-reservation-maintenance";
import { createWorkflowRuntime } from "~/server/workflow/runtime";

// What every workspace app shares with the host it runs in.
export interface WorkspaceHostServices {
  platformDb: Kysely<PlatformDatabase>;
  registry: CompanyRegistryClient;
  messaging: MessagingGateway;
  engine: EngineClient;
  organizationEnrichment: OrganizationEnrichment;
  avatars: AvatarService;
  config: {
    app: ReturnType<typeof appConfig>;
    notifications: ReturnType<typeof notificationsConfig>;
    uploads: ReturnType<typeof uploadsConfig>;
  };
}

// One workspace's application, built over its own store.
export function createWorkspaceApplication(
  workspace: WorkspaceInfrastructure,
  host: WorkspaceHostServices,
) {
  const { db } = workspace;
  const { publicOrigin } = host.config.app;

  const realtime = createRealtimeService({
    channels: () => [
      createEventLogsChannel(eventLogs),
      createJobsChannel([
        createGpvSnapshotProjector(merchantStats),
        createRecordImportProjector(recordImports),
        createIngestJobProjector(dataSourceUploads),
        createEnrichmentProjector(clientSearch),
      ]),
    ],
    effects: workspace.effects,
  });
  const eventLogs = createEventLogsService(db);
  const stopEventLogsTail = startEventLogsTail({
    db,
    effects: workspace.effects,
    realtime,
  });

  const files = createFilesRuntime(workspace, host.config.uploads);
  const extension = createExtensionRuntime(workspace, files.storage);
  const notifications = createNotificationsRuntime(workspace, {
    messaging: host.messaging,
    config: host.config.notifications,
    app: host.config.app,
  });

  const clientSearch = createClientSearchRuntime(workspace, {
    registry: host.registry,
    realtime,
    projectOrganization: createOrganizationEnrichmentProjection(
      createOrganizationRepo(db),
    ),
  });
  const integrations = createIntegrationRuntime({
    executor: db,
    enrichment: clientSearch,
  });
  const recordImports = createRecordImportsRuntime(
    integrations,
    files.storage,
    realtime,
  );
  const merchantStats = createMerchantStatsRuntime({ db, realtime, files });

  const dataSourceUploads = createDataSourceUploadsRuntime(host.engine);
  const ingestJobs = createIngestJobBridge({
    db,
    realtime,
    getJob: dataSourceUploads.getJob,
  });

  const accounts = createMemberAccounts(host.platformDb);
  const cases = createCasesRuntime({ executor: db, files });

  // The store's alarm runs these in order, so a queue a sweep feeds drains in
  // the same firing: notification expansion before dispatch.
  function createDuties(): Duty[] {
    const notificationQueues = notifications.createQueues();
    return [
      ...accountLifecycleDuties({
        ...createMemberWriteContext(db, accounts),
        messaging: host.messaging,
      }),
      leadReservationDuty(db),
      caseTimeoutDuty(db),
      extension.idleRecordingsDuty,
      workspaceCleanupDuty(db),
      ...[
        recordImports.createQueue(),
        merchantStats.imports.createQueue(),
        notificationQueues.expansion,
        notificationQueues.dispatch,
        notificationQueues.whatsappInbound,
        notificationQueues.outboundWhatsApp,
      ].map(queueDuty),
    ];
  }

  return {
    workspaceId: workspace.workspaceId,
    activities: createActivitiesRuntime({ executor: db }),
    admin: createAuditPolicyService({
      auditActionPolicies: createAuditActionPoliciesRepo(db),
    }),
    calls: createCallsRuntime({ executor: db, cases }),
    campaigns: createCampaignsRuntime({ executor: db }),
    capacity: createCapacityRuntime(workspace),
    cases,
    clientSearch,
    companies: createCompaniesRuntime({ executor: db }),
    contactHolds: createContactHoldsRuntime({
      executor: db,
      engine: host.engine,
    }),
    dataSourceUploads,
    ingestJobs,
    eventLogs,
    extension,
    files: { download: files.download },
    integration: { records: recordImports },
    createDuties,
    merchantStats,
    notifications,
    realtime: {
      openStream: realtime.openStream,
      stop(): void {
        stopEventLogsTail();
        realtime.stop();
      },
    },
    reports: createReportsRuntime({ executor: db, files, cases }),
    roles: createRolesRuntime(db),
    search: createSearchRuntime(workspace, host.engine),
    sessions: createWorkspaceSessions(db, workspace.workspaceId),
    team: createTeamRuntime(workspace, {
      platform: createInvitePlatform(host.platformDb),
      publicOrigin,
      messaging: host.messaging,
    }),
    users: createUsersRuntime(workspace, {
      accounts,
      avatars: host.avatars,
      publicOrigin,
    }),
    workflow: createWorkflowRuntime(workspace, {
      files,
      organizationEnrichment: host.organizationEnrichment,
      enrichmentQueue: clientSearch,
      registry: host.registry,
    }),
  };
}

export type WorkspaceApplication = ReturnType<
  typeof createWorkspaceApplication
>;
