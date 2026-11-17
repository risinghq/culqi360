import { expectErr } from "@tests/support/_core/assertions";
import { describe, expect, it } from "vitest";

import {
  MAX_RATE_REVISION_FILES,
  MAX_RATE_REVISION_ROUNDS,
} from "~/contracts/workflow/limits";
import { BASELINE_PERMISSIONS, type Role } from "~/domain/auth/access/rbac";
import { hydrateRuc } from "~/domain/identity/document";
import {
  BranchId,
  OrganizationId,
  UserId,
  WorkflowLeadId,
  WorkflowRateRevisionFileId,
  WorkflowRateRevisionId,
} from "~/domain/ids";
import {
  closeLead,
  qualifyLead,
  requestRateRevision,
  restartQuotation,
} from "~/server/workflow/lead/domain/decide";
import {
  authorizeFulfillmentStep,
  authorizeLeadAction,
  type LeadPolicyActor,
  resolveAvailableActions,
} from "~/server/workflow/lead/domain/policy";
import type { LeadState } from "~/server/workflow/lead/domain/state";
import { rejectRuleForStep } from "~/server/workflow/lead/fulfillment/steps";

function actor(userId: string, role: Role): LeadPolicyActor {
  return {
    userId: UserId.trust(userId),
    role,
    permissions: BASELINE_PERMISSIONS[role],
  };
}

function makeLeadState(overrides: Partial<LeadState> = {}): LeadState {
  return {
    id: WorkflowLeadId.trust("lead-1"),
    organizationId: OrganizationId.trust("org-1"),
    ruc: hydrateRuc("20600000001"),
    legalName: null,
    address: null,
    district: null,
    department: null,
    executiveId: UserId.trust("1"),
    branchId: BranchId.trust("1"),
    createdBy: UserId.trust("1"),
    updatedBy: null,
    stage: "PRICING",
    status: null,
    priority: null,
    createdAt: new Date(100),
    updatedAt: new Date(100),
    deletedAt: null,
    reservationExpiresAt: null,
    version: 0,
    ...overrides,
  };
}

describe("lead action policy", () => {
  it("blocks non-owners from owner-only pricing actions", () => {
    const lead = { executiveId: UserId.trust("1"), stage: "PRICING" as const };

    expect(
      authorizeLeadAction(
        "request-rate-revision",
        actor("2", "executive"),
        lead,
      ).ok,
    ).toBe(false);

    expect(
      authorizeLeadAction("accept-rate", actor("2", "executive"), lead).ok,
    ).toBe(false);
  });

  it("lets back office propose rates but not decide executive-only actions", () => {
    const lead = { executiveId: UserId.trust("1"), stage: "PRICING" as const };

    expect(
      authorizeLeadAction("propose-rate", actor("2", "back_office"), lead).ok,
    ).toBe(true);

    expect(
      authorizeLeadAction(
        "request-rate-revision",
        actor("2", "back_office"),
        lead,
      ).ok,
    ).toBe(false);
  });

  it("keeps delete restricted to management roles", () => {
    expect(
      authorizeLeadAction("delete", actor("1", "executive"), {
        executiveId: UserId.trust("1"),
        stage: "PRICING",
      }).ok,
    ).toBe(false);

    expect(
      authorizeLeadAction("delete", actor("2", "sales_manager"), {
        executiveId: UserId.trust("1"),
        stage: "PRICING",
      }).ok,
    ).toBe(true);
  });

  it("validates rate revision document and round limits in the transition", () => {
    expect(
      expectErr(
        requestRateRevision(makeLeadState(), {
          actor: actor("1", "executive"),
          revisionId: WorkflowRateRevisionId.trust("revision-1"),
          round: MAX_RATE_REVISION_ROUNDS + 1,
          justification: "Need better rate",
          fileIds: [WorkflowRateRevisionFileId.trust("file-1")],
          reservationExpiresAt: new Date(200),
          occurredAt: new Date(100),
        }),
      ).code,
    ).toBe("max_rate_revision_rounds_reached");

    expect(
      expectErr(
        requestRateRevision(makeLeadState(), {
          actor: actor("1", "executive"),
          revisionId: WorkflowRateRevisionId.trust("revision-1"),
          round: 1,
          justification: "Need better rate",
          fileIds: [],
          reservationExpiresAt: new Date(200),
          occurredAt: new Date(100),
        }),
      ).code,
    ).toBe("rate_revision_files_required");

    expect(
      expectErr(
        requestRateRevision(makeLeadState(), {
          actor: actor("1", "executive"),
          revisionId: WorkflowRateRevisionId.trust("revision-1"),
          round: 1,
          justification: "Need better rate",
          fileIds: Array.from(
            { length: MAX_RATE_REVISION_FILES + 1 },
            (_, index) => WorkflowRateRevisionFileId.trust(`file-${index}`),
          ),
          reservationExpiresAt: new Date(200),
          occurredAt: new Date(100),
        }),
      ).code,
    ).toBe("max_rate_revision_files_exceeded");

    expect(
      expectErr(
        requestRateRevision(makeLeadState(), {
          actor: actor("1", "executive"),
          revisionId: WorkflowRateRevisionId.trust("revision-1"),
          round: 1,
          justification: "Need better rate",
          fileIds: [
            WorkflowRateRevisionFileId.trust("file-1"),
            WorkflowRateRevisionFileId.trust("file-1"),
          ],
          reservationExpiresAt: new Date(200),
          occurredAt: new Date(100),
        }),
      ).code,
    ).toBe("duplicate_rate_revision_file");
  });

  it("offers close as a third pricing outcome to the owning executive, even before a proposal", () => {
    const actions = resolveAvailableActions(
      actor("1", "executive"),
      makeLeadState(),
      {
        hasActivePendingProposal: false,
        rateRevisionCount: 0,
        fulfillmentStep: null,
      },
    );
    expect(actions).toContain("close-lead");

    // Back office never closes; it only proposes.
    expect(
      resolveAvailableActions(actor("2", "back_office"), makeLeadState(), {
        hasActivePendingProposal: true,
        rateRevisionCount: 0,
        fulfillmentStep: null,
      }),
    ).not.toContain("close-lead");
  });

  it("closes a pricing lead as lost and transitions to CLOSED_LOST", () => {
    const result = closeLead(makeLeadState(), {
      actor: actor("1", "executive"),
      reason: "RATE",
      note: "Cliente no acepta la tasa",
      occurredAt: new Date(200),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.next.stage).toBe("CLOSED_LOST");
    expect(result.value.events.map((e) => e.eventType)).toContain(
      "lead_closed",
    );
  });

  it("rejects close outside pricing and from non-executives", () => {
    expect(
      expectErr(
        closeLead(makeLeadState({ stage: "SETUP" }), {
          actor: actor("1", "executive"),
          reason: "RATE",
          note: null,
          occurredAt: new Date(200),
        }),
      ).code,
    ).toBe("invalid_stage");

    expect(
      closeLead(makeLeadState(), {
        actor: actor("2", "back_office"),
        reason: "RATE",
        note: null,
        occurredAt: new Date(200),
      }).ok,
    ).toBe(false);
  });

  it("routes the transactions report to the owning executive and lets back office bounce it back", () => {
    const reportStep = "AWAITING_TRANSACTIONS_REPORT" as const;
    const state = {
      executiveId: UserId.trust("1"),
      stage: "FULFILLMENT" as const,
    };

    expect(
      authorizeFulfillmentStep(reportStep, actor("1", "executive"), state).ok,
    ).toBe(true);
    // A different executive cannot upload another executive's report.
    expect(
      authorizeFulfillmentStep(reportStep, actor("2", "executive"), state).ok,
    ).toBe(false);

    // Back office reviews the report while generating the addendum and can
    // reject it back to the executive for re-upload.
    expect(rejectRuleForStep("AWAITING_ADDENDUM")?.to).toBe(reportStep);
  });

  it("qualifies a lead into pricing and records status, priority, and stage", () => {
    const result = qualifyLead(makeLeadState({ stage: "QUALIFYING" }), {
      actor: actor("2", "back_office"),
      status: "DISPONIBLE",
      priority: "P1",
      reason: "Disponible para cotizar",
      occurredAt: new Date(200),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.next.stage).toBe("PRICING");
    expect(result.value.next.status).toBe("DISPONIBLE");
    expect(result.value.next.priority).toBe("P1");
    expect(result.value.events.map((e) => e.eventType)).toEqual([
      "lead_status_updated",
      "lead_priority_updated",
      "lead_reviewed",
      "workflow_stage_changed",
    ]);
  });

  it("routes a carterizado qualification to DISQUALIFIED", () => {
    const result = qualifyLead(makeLeadState({ stage: "QUALIFYING" }), {
      actor: actor("2", "back_office"),
      status: "CARTERIZADO",
      priority: "P2",
      reason: "Ya carterizado por otro canal",
      occurredAt: new Date(200),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.next.stage).toBe("DISQUALIFIED");
  });

  it("only qualifies while the lead is still QUALIFYING", () => {
    expect(
      expectErr(
        qualifyLead(makeLeadState({ stage: "PRICING" }), {
          actor: actor("2", "back_office"),
          status: "DISPONIBLE",
          priority: "P1",
          reason: "Ya no aplica",
          occurredAt: new Date(200),
        }),
      ).code,
    ).toBe("invalid_stage");
  });

  it("restarts an expired quotation back into pricing for owner and back office", () => {
    const owner = restartQuotation(makeLeadState({ stage: "EXPIRED" }), {
      actor: actor("1", "executive"),
      occurredAt: new Date(200),
    });
    expect(owner.ok).toBe(true);
    if (!owner.ok) {
      return;
    }
    expect(owner.value.next.stage).toBe("PRICING");

    // Back office does not own the lead but carries lead:view:all.
    expect(
      restartQuotation(makeLeadState({ stage: "EXPIRED" }), {
        actor: actor("2", "back_office"),
        occurredAt: new Date(200),
      }).ok,
    ).toBe(true);

    // Restart is only valid from EXPIRED.
    expect(
      expectErr(
        restartQuotation(makeLeadState({ stage: "PRICING" }), {
          actor: actor("1", "executive"),
          occurredAt: new Date(200),
        }),
      ).code,
    ).toBe("invalid_stage");
  });

  it("surfaces stage-gated actions: review, edit-commercial-scope, restart-quotation", () => {
    const meta = {
      hasActivePendingProposal: false,
      rateRevisionCount: 0,
      fulfillmentStep: null,
    };

    // Back office qualifies while the lead is QUALIFYING.
    expect(
      resolveAvailableActions(
        actor("2", "back_office"),
        makeLeadState({ stage: "QUALIFYING" }),
        meta,
      ),
    ).toContain("review");

    // The owning executive can correct their commercial input while pricing.
    expect(
      resolveAvailableActions(
        actor("1", "executive"),
        makeLeadState({ stage: "PRICING" }),
        meta,
      ),
    ).toContain("edit-commercial-scope");

    // A different executive holds the capability but does not own the lead.
    expect(
      resolveAvailableActions(
        actor("9", "executive"),
        makeLeadState({ stage: "PRICING" }),
        meta,
      ),
    ).not.toContain("edit-commercial-scope");

    // Restart is offered once the reservation lapsed and the lead is EXPIRED.
    expect(
      resolveAvailableActions(
        actor("1", "executive"),
        makeLeadState({ stage: "EXPIRED" }),
        meta,
      ),
    ).toContain("restart-quotation");
  });

  it("surfaces pricing actions from proposal state", () => {
    expect(
      resolveAvailableActions(actor("2", "back_office"), makeLeadState(), {
        hasActivePendingProposal: false,
        rateRevisionCount: 0,
        fulfillmentStep: null,
      }),
    ).toContain("propose-rate");

    const executiveActions = resolveAvailableActions(
      actor("1", "executive"),
      makeLeadState(),
      {
        hasActivePendingProposal: true,
        rateRevisionCount: 0,
        fulfillmentStep: null,
      },
    );
    expect(executiveActions).toContain("accept-rate");
    expect(executiveActions).toContain("request-rate-revision");

    expect(
      resolveAvailableActions(actor("1", "executive"), makeLeadState(), {
        hasActivePendingProposal: true,
        rateRevisionCount: MAX_RATE_REVISION_ROUNDS,
        fulfillmentStep: null,
      }),
    ).not.toContain("request-rate-revision");
  });
});
