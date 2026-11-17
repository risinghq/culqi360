export const CALL_REQUEST_SUBJECT_KINDS = [
  "assignment",
  "campaign_record",
  "case",
] as const;

export type CallRequestSubjectKind =
  (typeof CALL_REQUEST_SUBJECT_KINDS)[number];

/**
 * What the page asks the extension to call. `phone` is the number the user
 * picked; an assignment ignores it and dials the contact's own number.
 */
export interface CallHandoffRequest {
  subject: { kind: CallRequestSubjectKind; id: string };
  phone?: string | null;
}
