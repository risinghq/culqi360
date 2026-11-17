import type { ContactHoldStatus } from "~/contracts/contacts/vocabulary";
import type { ContactId, UserId } from "~/domain/ids";
import { addMilliseconds } from "~/domain/time/clock";

const DEFAULT_HOLD_TTL_HOURS = 24;

export type ContactHoldDraft = {
  user_id: UserId;
  contact_id: ContactId;
  held_at: Date;
  expires_at: Date;
  status: ContactHoldStatus;
};

export function createHold(
  userId: UserId,
  contactId: ContactId,
  heldAt: Date,
  ttlHours: number = DEFAULT_HOLD_TTL_HOURS,
): ContactHoldDraft {
  return {
    user_id: userId,
    contact_id: contactId,
    held_at: heldAt,
    expires_at: addMilliseconds(heldAt, ttlHours * 60 * 60 * 1000),
    status: "active",
  };
}
