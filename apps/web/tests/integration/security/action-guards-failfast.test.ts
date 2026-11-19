import { describe, expect, it } from "vitest";

import { ActionError } from "~/contracts/errors";
import { getUserLoginRetryReport } from "~/rpc/admin/auth-security";
import {
  createTeamInvite,
  resendTeamInvite,
  revokeTeamInvite,
} from "~/rpc/team/invites";
import { startImpersonation } from "~/rpc/users/impersonation";

async function rejectionCode(run: Promise<unknown>): Promise<unknown> {
  try {
    await run;
  } catch (error) {
    if (error instanceof ActionError) {
      return error.wire.code;
    }
    return undefined;
  }
  throw new Error("expected the action to reject");
}

describe("action guards fail fast", () => {
  it("rejects malformed numeric ids before auth", async () => {
    expect(await rejectionCode(startImpersonation(0))).toBe("invalid_user_id");
  });

  it("rejects malformed textual payloads before auth", async () => {
    expect(await rejectionCode(getUserLoginRetryReport("   "))).toBe(
      "username_required",
    );
    expect(
      await rejectionCode(
        createTeamInvite({
          names: "Test",
          firstSurname: "User",
          secondSurname: "Test",
          email: "bad-email",
          roleId: "01974fd5-f261-7a7d-93f5-2f3d0f961001",
          teamId: null,
        }),
      ),
    ).toBe("invalid_email");
    expect(
      await rejectionCode(
        createTeamInvite({
          names: "Test",
          firstSurname: "User",
          secondSurname: "Test",
          email: "test@example.com",
          roleId: "bad-role",
          teamId: null,
        }),
      ),
    ).toBe("invalid_role_id");
  });

  it("rejects invalid range/count values before auth", async () => {
    expect(await rejectionCode(resendTeamInvite(0))).toBe("invalid_invite_id");
    expect(await rejectionCode(revokeTeamInvite(0))).toBe("invalid_invite_id");
  });
});
