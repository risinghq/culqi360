import { makeAppContext, makeAuthSession } from "@tests/support/unit/factories";
import { describe, expect, it } from "vitest";

import { BASELINE_PERMISSIONS } from "~/domain/auth/access/rbac";
import { RoleId } from "~/domain/ids";
import type { WorkspaceInviteService } from "~/server/invites/application/types";
import { applyBulkImport } from "~/server/team/application/bulk-import";
import type { InviteDelivery } from "~/server/team/application/ports";
import type { TeamBulkImportContext } from "~/server/team/infrastructure/invite-context";
import { isErr } from "~/shared/result";

// Throw if authorization does not happen before invite side effects.
function untouchedDeps(): TeamBulkImportContext {
  const inviteService: WorkspaceInviteService = {
    listPendingInvites: () => {
      throw new Error(
        "listPendingInvites must not be called before the role check",
      );
    },
    createInvite: () => {
      throw new Error("createInvite must not be called before the role check");
    },
    renewInvite: () => {
      throw new Error("renewInvite must not be called before the role check");
    },
    revokeInvite: () => {
      throw new Error("revokeInvite must not be called before the role check");
    },
    markInviteDelivered: () => {
      throw new Error(
        "markInviteDelivered must not be called before the role check",
      );
    },
    placeMember: () => {
      throw new Error("placeMember must not be called before the role check");
    },
  };

  const delivery: InviteDelivery = {
    send: () => {
      throw new Error("send must not be called before the role check");
    },
  };

  return {
    repos: {
      roles: {
        findById: (id: RoleId) => Promise.resolve(ROLES_BY_ID.get(id)),
      },
    },
    inviteService,
    delivery,
    publicOrigin: "http://localhost:3000",
  };
}

const ADMIN_ROLE_ID = RoleId.trust("admin-role");
const EXECUTIVE_ROLE_ID = RoleId.trust("executive-role");

const ROLES_BY_ID = new Map(
  (["admin", "executive"] as const).map((kind) => {
    const id = kind === "admin" ? ADMIN_ROLE_ID : EXECUTIVE_ROLE_ID;
    return [
      id,
      {
        id,
        key: kind,
        name: kind,
        kind,
        permissions: [...BASELINE_PERMISSIONS[kind]],
        locked: false,
      },
    ];
  }),
);

function salesManager() {
  return makeAuthSession({
    role: "sales_manager",
    assignableRoleIds: [EXECUTIVE_ROLE_ID],
  });
}

describe("bulk import role authorization", () => {
  it("rejects an unassignable role before touching invite dependencies", async () => {
    const ctx = makeAppContext({ actor: salesManager() });

    const result = await applyBulkImport(ctx, untouchedDeps(), {
      csvContent: "irrelevant for this check",
      roleId: ADMIN_ROLE_ID,
    });

    expect(isErr(result)).toBe(true);

    if (!isErr(result)) {
      return;
    }

    expect(result.error.code).toBe("role_not_assignable");
  });

  it("allows an assignable role past the role check", async () => {
    const ctx = makeAppContext({ actor: salesManager() });

    const result = await applyBulkImport(ctx, untouchedDeps(), {
      csvContent: "",
      roleId: EXECUTIVE_ROLE_ID,
    });

    expect(isErr(result)).toBe(true);

    if (!isErr(result)) {
      return;
    }

    expect(result.error.code).toBe("team.bulk_import.csv_invalid");
  });
});
