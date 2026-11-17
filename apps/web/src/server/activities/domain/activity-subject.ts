import type { CampaignRecordId, CaseId, ContactId } from "~/domain/ids";

// What an activity works on. The schema allows at most one subject per
// activity; none means it is about the company alone.
export type ActivitySubject =
  | { kind: "contact"; contactId: ContactId }
  | { kind: "campaign_record"; campaignRecordId: CampaignRecordId }
  | { kind: "case"; caseId: CaseId };

// The three subject columns shared by `activities` and `extension_handoffs`.
export function subjectColumns(subject: ActivitySubject | null) {
  return {
    campaign_record_id:
      subject?.kind === "campaign_record" ? subject.campaignRecordId : null,
    case_id: subject?.kind === "case" ? subject.caseId : null,
    contact_id: subject?.kind === "contact" ? subject.contactId : null,
  };
}
