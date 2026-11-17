import { fail, type DomainError } from "~/domain/errors";
import type {
  BranchId,
  CampaignRecordId,
  CaseId,
  ContactHoldId,
  OrganizationId,
  UserId,
} from "~/domain/ids";
import type { CampaignsRepo } from "~/server/campaigns/infrastructure/campaigns-repo";
import type { CasesRuntime } from "~/server/cases/runtime";
import type { ContactHoldsRepo } from "~/server/contacts/infrastructure/hold-repo";
import type { OrganizationRepository } from "~/server/organization/organization-repo";
import { Err, isErr, Ok, type Result } from "~/shared/result";

import {
  normalizePhone,
  type CallSubject,
  type CallTarget,
} from "../domain/call-target";

// What the user asked to call. A contact hold resolves to its person.
export type CallRequestSubject =
  | { kind: "contact_hold"; contactHoldId: ContactHoldId }
  | { kind: "campaign_record"; campaignRecordId: CampaignRecordId }
  | { kind: "case"; caseId: CaseId };

export type CallRequest = {
  subject: CallRequestSubject;
  // A number the user picked for a record or a case, such as one from the
  // record's facts. A person is called on their stored number. Either falls
  // back to the company's number.
  phone: string | null;
};

export type CallActor = {
  userId: UserId;
  branchId: BranchId;
  roleKey: string;
  viewAll: boolean;
};

export type CallTargetPorts = {
  contactHolds: Pick<ContactHoldsRepo, "findActiveByIdForUser">;
  organization: Pick<
    OrganizationRepository,
    "findMembershipById" | "findOrganizationById"
  >;
  campaigns: Pick<CampaignsRepo, "findHeldRecord">;
  cases: Pick<CasesRuntime, "read">;
};

type Resolved = {
  organizationId: OrganizationId;
  subject: CallSubject;
  phone: string | null;
  clientName: string | null;
};

async function resolveSubject(
  ports: CallTargetPorts,
  actor: CallActor,
  request: CallRequest,
  at: Date,
): Promise<Resolved | null> {
  const { subject } = request;
  switch (subject.kind) {
    case "contact_hold": {
      const hold = await ports.contactHolds.findActiveByIdForUser(
        subject.contactHoldId,
        actor.userId,
        at,
      );
      if (!hold) {
        return null;
      }
      const member = await ports.organization.findMembershipById(
        hold.contact_id,
      );
      if (!member) {
        return null;
      }
      return {
        organizationId: member.organizationId,
        subject: { kind: "contact", contactId: member.id },
        phone: member.phone,
        clientName: member.person.displayName,
      };
    }
    case "campaign_record": {
      const held = await ports.campaigns.findHeldRecord(
        subject.campaignRecordId,
        actor.userId,
      );
      if (!held) {
        return null;
      }
      return {
        organizationId: held.organizationId,
        subject: subject,
        phone: request.phone,
        clientName: null,
      };
    }
    case "case": {
      const read = await ports.cases.read({
        caseId: subject.caseId,
        actorUserId: actor.userId,
        roleKey: actor.roleKey,
        branchId: actor.branchId,
        viewAll: actor.viewAll,
        canReassign: false,
      });
      if (isErr(read)) {
        return null;
      }
      return {
        organizationId: read.value.detail.organizationId,
        subject: subject,
        phone: request.phone,
        clientName: null,
      };
    }
  }
}

export async function resolveCallTarget(
  ports: CallTargetPorts,
  actor: CallActor,
  request: CallRequest,
  at: Date,
): Promise<Result<CallTarget, DomainError>> {
  const resolved = await resolveSubject(ports, actor, request, at);
  if (!resolved) {
    return Err(fail("call_subject_not_found"));
  }
  const organization = await ports.organization.findOrganizationById(
    resolved.organizationId,
  );
  if (!organization) {
    return Err(fail("call_subject_not_found"));
  }
  const phone = normalizePhone(resolved.phone ?? organization.phone ?? "");
  if (!phone) {
    return Err(fail("call_phone_missing"));
  }
  const organizationLabel = organization.legalName ?? organization.ruc;
  return Ok({
    organizationId: organization.id,
    subject: resolved.subject,
    phone,
    clientName: resolved.clientName ?? organizationLabel,
    organizationLabel,
  });
}
