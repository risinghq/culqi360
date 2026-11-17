import type {
  BulkApplyResult,
  BulkParseResult,
} from "~/contracts/team/bulk-import";
import { canAssignRole } from "~/domain/auth/access/member-management";
import type { Role } from "~/domain/auth/access/rbac";
import { fail, invalid, type DomainError } from "~/domain/errors";
import { shortName } from "~/domain/identity/display-name";
import type { RoleId } from "~/domain/ids";
import { inviteLink } from "~/server/invites/domain/invite-link";
import type { AppContext } from "~/server/platform/action/context";
import {
  applyImport,
  parseAndValidateCsvRows,
} from "~/server/users/service-bulk-import";
import { Err, isErr, Ok, type Result } from "~/shared/result";

import type { TeamBulkImportContext } from "../infrastructure/invite-context";

interface BulkImportRole {
  id: RoleId;
  kind: Role;
  name: string;
}

type BulkImportRoles = Pick<TeamBulkImportContext, "repos">;

async function resolveAssignableRole(
  ctx: AppContext,
  deps: BulkImportRoles,
  roleId: RoleId,
): Promise<Result<BulkImportRole, DomainError>> {
  const role = await deps.repos.roles.findById(roleId);
  if (!role || !canAssignRole(ctx.actor, role)) {
    return Err(fail("role_not_assignable"));
  }
  return Ok(role);
}

function parseBulkCsv(
  csvContent: string,
  role: Role,
  operationAt: Date,
): Result<BulkParseResult, DomainError> {
  const parsed = parseAndValidateCsvRows(csvContent, role, operationAt);
  if (!parsed.ok) {
    return Err(
      invalid({
        code: "team.bulk_import.csv_invalid",
        details: { parseError: parsed.error.message },
      }),
    );
  }
  return Ok(parsed.value);
}

export async function previewBulkImport(
  ctx: AppContext,
  deps: BulkImportRoles,
  input: { csvContent: string; roleId: RoleId },
): Promise<Result<BulkParseResult, DomainError>> {
  const role = await resolveAssignableRole(ctx, deps, input.roleId);
  if (isErr(role)) {
    return role;
  }
  return parseBulkCsv(input.csvContent, role.value.kind, ctx.operationAt);
}

export async function applyBulkImport(
  ctx: AppContext,
  deps: TeamBulkImportContext,
  input: {
    csvContent: string;
    roleId: RoleId;
  },
): Promise<Result<BulkApplyResult, DomainError>> {
  const role = await resolveAssignableRole(ctx, deps, input.roleId);
  if (isErr(role)) {
    return role;
  }

  const parsed = parseBulkCsv(
    input.csvContent,
    role.value.kind,
    ctx.operationAt,
  );
  if (!parsed.ok) {
    return parsed;
  }

  if (parsed.value.valid.length === 0) {
    return Err(invalid({ code: "team.bulk_import.no_valid_rows" }));
  }

  const result = await applyImport(
    parsed.value.valid,
    ctx.actor,
    role.value.id,
    deps.inviteService,
    async ({ row, inviteId, token, expiresAt, roleName }) => {
      const emailResult = await deps.delivery.send({
        email: row.email,
        fullName: shortName({
          names: row.names,
          firstSurname: row.firstSurname,
          secondSurname: row.secondSurname,
        }),
        roleName,
        inviteUrl: inviteLink(deps.publicOrigin, token),
        expiresAt,
      });
      // Re-throw failures: applyImport's per-row loop catches into rowErrors,
      // so a Result check here could not signal the loop.
      if (isErr(emailResult)) {
        const { error } = emailResult;
        const message =
          error.kind === "external" || error.kind === "internal"
            ? error.internalMessage
            : (error.code ?? error.kind);
        throw new Error(message);
      }
      await deps.inviteService.markInviteDelivered(inviteId, ctx);
    },
    ctx,
  );

  return Ok(result);
}
