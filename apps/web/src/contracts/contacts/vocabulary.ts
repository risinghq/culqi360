export type ContactHoldStatus = "active" | "completed" | "expired";

export const CONTACT_HOLD_CALL_OUTCOMES = [
  "no_answer",
  "callback_scheduled",
  "sale_made",
  "invalid_data",
] as const;

export type ContactHoldCallOutcome =
  (typeof CONTACT_HOLD_CALL_OUTCOMES)[number];
