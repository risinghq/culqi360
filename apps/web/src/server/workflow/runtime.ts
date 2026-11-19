import { parseRuc } from "~/domain/identity/document";
import type { CompanyRegistryClient } from "~/server/client-search/ports";
import type { FileRepos } from "~/server/files/service/contracts";
import type {
  OrganizationEnrichment,
  OrganizationEnrichmentQueue,
} from "~/server/organization/enrichment";
import type { WorkspaceExecutor } from "~/server/platform/database/executor";
import type { BlobStore } from "~/server/platform/files/blob-store";
import type { WorkspaceInfrastructure } from "~/server/platform/infrastructure";
import type { OperationContext } from "~/server/platform/operation/context";
import { createInquiry } from "~/server/workflow/inquiry/create-inquiry";
import { listInquiriesForExecutive } from "~/server/workflow/inquiry/inquiry-queries";
import { acceptRateCommand } from "~/server/workflow/lead/commands/accept-rate";
import { addToFavoritesCommand } from "~/server/workflow/lead/commands/add-to-favorites";
import { closeLeadCommand } from "~/server/workflow/lead/commands/close-lead";
import { deleteLeadCommand } from "~/server/workflow/lead/commands/delete-lead";
import { editCommercialScopeCommand } from "~/server/workflow/lead/commands/edit-commercial-scope";
import { editRateProposalCommand } from "~/server/workflow/lead/commands/edit-rate-proposal";
import { proposeRateCommand } from "~/server/workflow/lead/commands/propose-rate";
import { reassignLeadCommand } from "~/server/workflow/lead/commands/reassign-lead";
import { recordRepLegalCommand } from "~/server/workflow/lead/commands/record-rep-legal";
import { registerLead } from "~/server/workflow/lead/commands/register-lead";
import { removeFromFavoritesCommand } from "~/server/workflow/lead/commands/remove-from-favorites";
import { requestRateRevisionCommand } from "~/server/workflow/lead/commands/request-rate-revision";
import { requestSunatRefresh } from "~/server/workflow/lead/commands/request-sunat-refresh";
import { restartQuotationCommand } from "~/server/workflow/lead/commands/restart-quotation";
import { reviewLeadCommand } from "~/server/workflow/lead/commands/review-lead";
import { saveDigitalPolicyCommand } from "~/server/workflow/lead/digital-policy/write";
import { resolvePendingQuotationPolicy } from "~/server/workflow/lead/domain/pending-quotation";
import { createLeadFilesService } from "~/server/workflow/lead/files/lead-files";
import {
  chooseFulfillmentProductCommand,
  recordUnitSerialCommand,
  registerUnitPaymentLinkCommand,
  registerUnitSaleCommand,
  rejectFulfillmentStepCommand,
  validateFulfillmentPaymentCommand,
} from "~/server/workflow/lead/fulfillment/commands";
import { addLeadNote } from "~/server/workflow/lead/interaction/write";
import { getLeadBootstrapPreview } from "~/server/workflow/lead/read/queries/get-lead-bootstrap-preview";
import { getLeadDetail } from "~/server/workflow/lead/read/queries/get-lead-detail";
import { listAssignableExecutives } from "~/server/workflow/lead/read/queries/list-assignable-executives";
import { listFulfillmentQueue } from "~/server/workflow/lead/read/queries/list-fulfillment-queue";
import { listLeads } from "~/server/workflow/lead/read/queries/list-leads";
import { addVenueAccountsCommand } from "~/server/workflow/lead/venue/add-venue-accounts";
import { createVenueCommand } from "~/server/workflow/lead/venue/create-venue";
import { updateVenueCommand } from "~/server/workflow/lead/venue/update-venue";
import { createLeadRepo } from "~/server/workflow/lead/write/lead-repo";
import { createSourceStatusRepo } from "~/server/workflow/lead/write/source-status-repo";
import { getPendingQuotationPolicy } from "~/server/workflow/policy/read/get-pending-quotation-policy";
import { getRateProposalPolicy } from "~/server/workflow/policy/read/get-rate-proposal-policy";
import { updatePendingQuotationPolicy } from "~/server/workflow/policy/write/update-pending-quotation-policy";
import { updateRateProposalPolicy } from "~/server/workflow/policy/write/update-rate-proposal-policy";
import { createWorkflowRepos } from "~/server/workflow/repos";
import type { WorkflowWriteContext } from "~/server/workflow/types";

function bindWorkflowCommand<TInput, TOutput>(
  executor: WorkspaceExecutor,
  command: (input: TInput, scope: WorkflowWriteContext) => TOutput,
) {
  return (input: TInput, operation: OperationContext): TOutput =>
    command(input, { executor, operationAt: operation.operationAt });
}

export function createWorkflowRuntime(
  workspace: Pick<WorkspaceInfrastructure, "db">,
  deps: {
    files: { repo: FileRepos; storage: BlobStore };
    organizationEnrichment: OrganizationEnrichment;
    enrichmentQueue: OrganizationEnrichmentQueue;
    registry: Pick<CompanyRegistryClient, "getStatus">;
  },
) {
  const { files, organizationEnrichment, enrichmentQueue } = deps;
  const repos = createWorkflowRepos(workspace.db);
  const leadRepo = createLeadRepo(workspace.db);
  const sourceStatuses = createSourceStatusRepo(deps.registry);

  const command = <TInput, TOutput>(
    handler: (input: TInput, scope: WorkflowWriteContext) => TOutput,
  ) => bindWorkflowCommand(workspace.db, handler);

  const filesService = createLeadFilesService({
    leadReader: leadRepo,
    leadQueries: repos.leadQueries,
    fulfillment: repos.fulfillment,
    filesRepo: files.repo,
    filesStorage: files.storage,
    executor: workspace.db,
  });

  return {
    commands: {
      addLeadNote: command(addLeadNote),
      addToFavorites: command(addToFavoritesCommand),
      addVenueAccounts: command(addVenueAccountsCommand),
      acceptRate: command(acceptRateCommand),
      chooseFulfillmentProduct: command(chooseFulfillmentProductCommand),
      closeLead: command(closeLeadCommand),
      createInquiry: command(createInquiry),
      createVenue: command(createVenueCommand),
      deleteLead: command(deleteLeadCommand),
      editCommercialScope: command(editCommercialScopeCommand),
      editRateProposal: command(editRateProposalCommand),
      proposeRate: command(proposeRateCommand),
      reassignLead: command(reassignLeadCommand),
      recordFulfillmentSerial: command(recordUnitSerialCommand),
      recordRepLegal: command(recordRepLegalCommand),
      registerFulfillmentPaymentLink: command(registerUnitPaymentLinkCommand),
      registerFulfillmentSale: command(registerUnitSaleCommand),
      registerLead: async (
        input: Parameters<typeof registerLead>[0],
        operation: OperationContext,
      ) => {
        const result = await registerLead(
          input,
          {
            executor: workspace.db,
            operationAt: operation.operationAt,
          },
          { identity: organizationEnrichment },
        );
        const ruc = parseRuc(input.ruc);
        // The registry lives in another store, so the request follows the
        // commit. A request lost on a crash is recovered by "Actualizar SUNAT".
        if (result.ok && ruc.ok) {
          await enrichmentQueue.requestRucs(
            [ruc.value],
            input.actor.userId,
            operation,
          );
        }
        return result;
      },
      rejectFulfillmentStep: command(rejectFulfillmentStepCommand),
      removeFromFavorites: command(removeFromFavoritesCommand),
      requestRateRevision: command(requestRateRevisionCommand),
      requestSunatRefresh: (
        input: Parameters<typeof requestSunatRefresh>[0],
        operation: OperationContext,
      ) =>
        requestSunatRefresh(
          input,
          { leads: repos.leads, enrichmentQueue },
          operation,
        ),
      restartQuotation: command(restartQuotationCommand),
      reviewLead: command(reviewLeadCommand),
      saveDigitalPolicy: command(saveDigitalPolicyCommand),
      updatePendingQuotationPolicy: (
        input: Parameters<typeof updatePendingQuotationPolicy>[0],
        operation: OperationContext,
      ) =>
        updatePendingQuotationPolicy(
          input,
          repos.pendingQuotationPolicies,
          operation,
        ),
      updateRateProposalPolicy: (
        input: Parameters<typeof updateRateProposalPolicy>[0],
        operation: OperationContext,
      ) =>
        updateRateProposalPolicy(input, repos.rateProposalPolicies, operation),
      updateVenue: command(updateVenueCommand),
      validateFulfillmentPayment: command(validateFulfillmentPaymentCommand),
    },
    files: filesService,
    queries: {
      getLeadBootstrapPreview: (
        input: Parameters<typeof getLeadBootstrapPreview>[2],
      ) =>
        getLeadBootstrapPreview(
          { organization: repos.organization },
          organizationEnrichment,
          input,
        ),
      getLeadDetail: (
        input: Parameters<typeof getLeadDetail>[1],
        operation: OperationContext,
      ) => getLeadDetail({ ...repos, sourceStatuses }, input, operation),
      getPendingQuotationPolicy: (
        input: Parameters<typeof getPendingQuotationPolicy>[1],
      ) =>
        getPendingQuotationPolicy(
          { pendingQuotationPolicies: repos.pendingQuotationPolicies },
          input,
        ),
      getRateProposalPolicy: (
        input: Parameters<typeof getRateProposalPolicy>[1],
      ) =>
        getRateProposalPolicy(
          { rateProposalPolicies: repos.rateProposalPolicies },
          input,
        ),
      listAssignableExecutives: (
        input: Parameters<typeof listAssignableExecutives>[1],
      ) => listAssignableExecutives(repos, input),
      listFulfillmentQueue: (
        input: Parameters<typeof listFulfillmentQueue>[1],
      ) => listFulfillmentQueue(workspace.db, input),
      listInquiriesForExecutive: (
        userId: Parameters<typeof listInquiriesForExecutive>[1],
      ) => listInquiriesForExecutive(workspace.db, userId),
      listLeads: (
        input: Parameters<typeof listLeads>[1],
        operation: OperationContext,
      ) => listLeads({ leads: repos.leadQueries }, input, operation),
      pendingQuotationCount: async (
        userId: Parameters<
          typeof repos.leads.countPendingQuotationDecisions
        >[0],
        branchId: Parameters<
          typeof repos.pendingQuotationPolicies.findByBranchId
        >[0],
        operation: OperationContext,
      ) => {
        const [count, branchPolicy] = await Promise.all([
          repos.leads.countPendingQuotationDecisions(
            userId,
            operation.operationAt,
          ),
          repos.pendingQuotationPolicies.findByBranchId(branchId),
        ]);
        const { limit } = resolvePendingQuotationPolicy({ branchPolicy });
        return { count, limit };
      },
    },
  };
}
