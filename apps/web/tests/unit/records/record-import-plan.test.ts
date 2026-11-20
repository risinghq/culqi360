import { describe, expect, it } from "vitest";

import { BASELINE_PERMISSIONS } from "~/domain/auth/access/rbac";
import { hydrateRuc } from "~/domain/identity/document";
import {
  BranchId,
  OrganizationId,
  UserId,
  WorkflowInquiryId,
  WorkflowLeadId,
} from "~/domain/ids";
import { planRecordImport } from "~/server/records/imports/plan";
import type { ImportRowInput } from "~/server/records/imports/types";
import type { WorkflowActor } from "~/server/workflow/actor";
import type { InquiryRow } from "~/server/workflow/inquiry/repo";
import type { LeadState } from "~/server/workflow/lead/domain/state";

const RUC = "20600000001";
const OTHER_RUC = "20600000002";
const AT = new Date("2026-11-19T12:00:00.000Z");

const ACTOR: WorkflowActor = {
  userId: UserId.trust("back-office"),
  role: "back_office",
  permissions: BASELINE_PERMISSIONS.back_office,
  branchId: BranchId.trust("branch-1"),
};

function lead(overrides: Partial<LeadState> = {}): LeadState {
  return {
    id: WorkflowLeadId.trust("lead-1"),
    organizationId: OrganizationId.trust("org-1"),
    ruc: hydrateRuc(RUC),
    legalName: null,
    address: null,
    district: null,
    department: null,
    executiveId: UserId.trust("executive"),
    branchId: BranchId.trust("branch-1"),
    createdBy: UserId.trust("executive"),
    updatedBy: null,
    stage: "QUALIFYING",
    status: null,
    priority: null,
    createdAt: new Date(100),
    updatedAt: new Date(100),
    deletedAt: null,
    reservationExpiresAt: null,
    version: 3,
    ...overrides,
  };
}

function inquiry(overrides: Partial<InquiryRow> = {}): InquiryRow {
  return {
    id: WorkflowInquiryId.trust("inquiry-1"),
    ruc: RUC,
    executiveId: UserId.trust("executive"),
    state: "PENDING",
    status: null,
    priority: null,
    answeredAt: null,
    answeredBy: null,
    convertedLeadId: null,
    createdAt: new Date(100),
    ...overrides,
  };
}

function status(row: number, ruc = RUC): ImportRowInput {
  return { row, ruc, type: "import_status", status: "DISPONIBLE" };
}

function priority(row: number, ruc = RUC): ImportRowInput {
  return { row, ruc, type: "import_prioridad", priority: "P1" };
}

function plan(input: {
  rows: ImportRowInput[];
  leads?: LeadState[];
  inquiries?: InquiryRow[];
}) {
  return planRecordImport({
    rows: input.rows,
    actor: ACTOR,
    operationAt: AT,
    leads: input.leads ?? [],
    inquiries: input.inquiries ?? [],
  });
}

describe("record import plan", () => {
  it("moves a lead through two lines from the version it was read at", () => {
    const result = plan({ rows: [priority(1), status(2)], leads: [lead()] });

    expect(result.applied).toBe(2);
    expect(result.leads).toHaveLength(1);
    const [change] = result.leads;
    expect(change?.fromVersion).toBe(3);
    expect(change?.next).toMatchObject({
      stage: "PRICING",
      status: "DISPONIBLE",
      priority: "P1",
      version: 5,
    });
    expect(result.events.map((event) => event.eventType)).toEqual([
      "lead_priority_updated",
      "lead_status_updated",
      "lead_reviewed",
      "workflow_stage_changed",
    ]);
  });

  it("records a priority-only line without reviewing the stage", () => {
    const result = plan({ rows: [priority(1)], leads: [lead()] });

    expect(result.leads[0]?.next).toMatchObject({
      stage: "QUALIFYING",
      priority: "P1",
      status: null,
      version: 4,
    });
    expect(result.events.map((event) => event.eventType)).toEqual([
      "lead_priority_updated",
    ]);
  });

  it("answers an inquiry once and keeps the first answer time", () => {
    const result = plan({
      rows: [status(1), priority(2)],
      inquiries: [inquiry()],
    });

    expect(result.applied).toBe(2);
    expect(result.newlyAnswered.map((row) => row.id)).toEqual([
      WorkflowInquiryId.trust("inquiry-1"),
    ]);
    expect(result.answered).toEqual([
      expect.objectContaining({
        state: "ANSWERED",
        status: "DISPONIBLE",
        priority: "P1",
        answeredAt: AT,
        answeredBy: ACTOR.userId,
      }),
    ]);
  });

  it("leaves an inquiry pending until a status arrives", () => {
    const result = plan({ rows: [priority(1)], inquiries: [inquiry()] });

    expect(result.answered[0]).toMatchObject({
      state: "PENDING",
      priority: "P1",
      answeredAt: null,
    });
    expect(result.newlyAnswered).toEqual([]);
  });

  it("does not count a line with no live inquiry and no reviewable lead", () => {
    const result = plan({
      rows: [status(1, OTHER_RUC), status(2)],
      leads: [lead({ stage: "PRICING" })],
    });

    expect(result).toMatchObject({ applied: 0, leads: [], events: [] });
  });
});
