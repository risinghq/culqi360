import type {
  CampaignRecordId,
  CaseId,
  OrganizationId,
  OrganizationPersonId,
} from "~/domain/ids";

// What a call is about. The schema allows at most one subject per call.
export type CallSubject =
  | { kind: "person"; organizationPersonId: OrganizationPersonId }
  | { kind: "campaign_record"; campaignRecordId: CampaignRecordId }
  | { kind: "case"; caseId: CaseId };

// A call the user may place: the company, the subject, the number to dial and
// the labels the extension shows while the call runs.
export type CallTarget = {
  organizationId: OrganizationId;
  subject: CallSubject;
  phone: string;
  clientName: string;
  organizationLabel: string;
};

const PHONE_DIGITS = /^\+?\d{6,15}$/;

// Keeps a leading plus and the digits; returns null when too short or long to
// dial.
export function normalizePhone(raw: string): string | null {
  const phone = raw.replaceAll(/[\s().-]/g, "");
  return PHONE_DIGITS.test(phone) ? phone : null;
}
