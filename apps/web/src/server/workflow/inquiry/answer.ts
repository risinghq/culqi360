import type { LeadPriority, LeadStatus } from "~/contracts/workflow/vocabulary";
import type { UserId } from "~/domain/ids";

import type { InquiryRow } from "./repo";

/** Stamps a live inquiry with whichever answer field a records line carries.
 * An inquiry counts as answered once it has a status; a priority-only answer
 * fills the field but keeps the inquiry pending. */
export function answerInquiry(
  inquiry: InquiryRow,
  answer: {
    status?: LeadStatus;
    priority?: LeadPriority;
    answeredBy: UserId;
    answeredAt: Date;
  },
): InquiryRow {
  const status = answer.status ?? inquiry.status;
  const priority = answer.priority ?? inquiry.priority;
  const answered = status !== null;
  return {
    ...inquiry,
    status,
    priority,
    state: answered ? "ANSWERED" : "PENDING",
    answeredAt: answered ? (inquiry.answeredAt ?? answer.answeredAt) : null,
    answeredBy: answer.answeredBy,
  };
}
