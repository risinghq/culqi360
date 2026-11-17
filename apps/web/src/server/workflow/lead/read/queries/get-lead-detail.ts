import type { LeadDetailView } from "~/contracts/workflow/views";
import type { DomainError } from "~/domain/errors";
import type { WorkflowLeadId } from "~/domain/ids";
import type { OperationContext } from "~/server/platform/operation/context";
import {
  authorizeLeadAction,
  canRevealFullTimeline,
  type LeadPolicyActor,
  resolveAvailableActions,
} from "~/server/workflow/lead/domain/policy";
import { isReservationActive } from "~/server/workflow/lead/domain/reservation";
import { Ok, type Result } from "~/shared/result";

import { presentLeadDetail } from "../presenters/lead-detail";
import {
  loadLeadDetailSections,
  type LeadDetailQueryDeps,
} from "./load-lead-detail-sections";

export async function getLeadDetail(
  deps: LeadDetailQueryDeps,
  input: {
    actor: LeadPolicyActor;
    leadId: WorkflowLeadId;
  },
  operation: OperationContext,
): Promise<Result<LeadDetailView, DomainError>> {
  const { actor } = input;
  const loaded = await loadLeadDetailSections(
    deps,
    { leadId: input.leadId, actorUserId: actor.userId },
    operation,
  );
  if (!loaded.ok) {
    return loaded;
  }
  const { lead } = loaded.value;

  const canAccess = authorizeLeadAction("view", actor, lead);
  if (!canAccess.ok) {
    return canAccess;
  }

  const userMap = new Map(loaded.value.userRows.map((u) => [u.id, u.fullName]));
  const executiveName = userMap.get(lead.executiveId) ?? "Desconocido";
  const createdByName = userMap.get(lead.createdBy) ?? "Desconocido";
  const updatedByName = lead.updatedBy
    ? (userMap.get(lead.updatedBy) ?? null)
    : null;

  const latestProposal = loaded.value.rateProposals.at(-1);
  const canRevealTimeline = canRevealFullTimeline(actor.role);
  const availableActions = resolveAvailableActions(actor, lead, {
    hasActivePendingProposal:
      latestProposal?.outcome === "pending" &&
      isReservationActive(lead, operation.operationAt),
    rateRevisionCount: loaded.value.rateRevisionRows.length,
    fulfillmentStep: loaded.value.fulfillment?.order.currentStep ?? null,
  });

  return Ok(
    presentLeadDetail({
      lead,
      isFavorite: loaded.value.isFavorite,
      executiveName,
      createdByName,
      updatedByName,
      commercialScope: loaded.value.commercialScope,
      digitalPolicy: loaded.value.digitalPolicy,
      rateProposals: loaded.value.rateProposals,
      venues: loaded.value.venues,
      rateRevisions: loaded.value.rateRevisions,
      history: loaded.value.history,
      canRevealFullTimeline: canRevealTimeline,
      availableActions,
      sourceStatus: loaded.value.sourceStatus,
      organization: loaded.value.organization,
      legalRepresentative: loaded.value.legalRepresentative,
      fulfillment: loaded.value.fulfillment,
    }),
  );
}
