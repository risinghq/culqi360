import { fail, type DomainError } from "~/domain/errors";
import {
  isExecutiveCategory,
  type ExecutiveCategory,
} from "~/domain/identity/executive-category";
import type { RoleId, TeamId } from "~/domain/ids";
import { appCalendarDateAt, appDayRange } from "~/domain/time/app-time";
import {
  addCalendarDays,
  type CalendarDate,
} from "~/domain/time/calendar-date";
import type { OperationContext } from "~/server/platform/operation/context";
import { Err, Ok, type Result } from "~/shared/result";

import type { CreateTeamInviteCommand } from "../application/contracts";

// Cross-field and format rules: applied identically by single and bulk
// creation paths. Email is shape-only here; the invites domain lower-cases
// and dedupes.
export type TeamInviteShape = {
  names: string;
  firstSurname: string;
  secondSurname: string;
  email: string;
  roleId: RoleId;
  executiveCategory: string | null;
  teamId: TeamId | null;
  expiresOn: CalendarDate | null;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_EXPIRY_DAYS = 7;

export function validateTeamInviteInput(
  input: TeamInviteShape,
  operation: OperationContext,
): Result<CreateTeamInviteCommand, DomainError> {
  const shape = validateTeamInviteShape(input);
  if (!shape.ok) {
    return shape;
  }

  const expiresAt = validateExpiry(input.expiresOn, operation.operationAt);

  if (!expiresAt.ok) {
    return expiresAt;
  }

  return Ok({
    names: input.names,
    firstSurname: input.firstSurname,
    secondSurname: input.secondSurname,
    email: input.email,
    roleId: input.roleId,
    executiveCategory: shape.value,
    teamId: input.teamId,
    expiresAt: expiresAt.value,
  });
}

/** Validates an invite independently of the request instant. */
export function validateTeamInviteShape(
  input: TeamInviteShape,
): Result<ExecutiveCategory | null, DomainError> {
  if (!EMAIL_PATTERN.test(input.email)) {
    return Err(fail("invalid_email"));
  }

  const category = resolveExecutiveCategory(input.executiveCategory);

  if (!category.ok) {
    return category;
  }

  if (input.teamId !== null && input.teamId.trim().length === 0) {
    return Err(fail("invalid_team_id"));
  }

  return Ok(category.value);
}

// Only the role's kind decides whether a category is required, and the
// request carries a role id, so createInvite enforces that rule.
function resolveExecutiveCategory(
  executiveCategory: string | null,
): Result<ExecutiveCategory | null, DomainError> {
  if (!executiveCategory) {
    return Ok(null);
  }

  if (!isExecutiveCategory(executiveCategory)) {
    return Err(fail("invalid_executive_category"));
  }

  return Ok(executiveCategory);
}

function validateExpiry(
  expiresOn: CalendarDate | null,
  requestedAt: Date,
): Result<Date | null, DomainError> {
  if (expiresOn === null) {
    return Ok(null);
  }

  const minimum = addCalendarDays(
    appCalendarDateAt(requestedAt),
    MIN_EXPIRY_DAYS,
  );
  if (expiresOn < minimum) {
    return Err(fail("expires_on_too_soon"));
  }

  return Ok(appDayRange(expiresOn).endExclusive);
}
