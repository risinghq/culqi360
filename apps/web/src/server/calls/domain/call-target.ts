import type { OrganizationId } from "~/domain/ids";
import type { ActivitySubject } from "~/server/activities/domain/activity-subject";

// A call the user may place: the company, the subject, the number to dial and
// the labels the extension shows while the call runs.
export type CallTarget = {
  organizationId: OrganizationId;
  subject: ActivitySubject;
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
