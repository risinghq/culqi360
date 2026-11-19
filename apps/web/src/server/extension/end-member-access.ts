import type { UserId } from "~/domain/ids";

import type { ExtensionRuntimeRepo } from "./repos";

// Ends the member's extension installations in this workspace and marks the
// executive's sync as needing a fresh login. With an auth session id only the
// installations bound to that login end.
export async function endMemberExtensionAccess(
  extension: Pick<
    ExtensionRuntimeRepo,
    | "revokeInstallationSessionsByAuthSession"
    | "revokeInstallationSessionsByUser"
    | "updateExecutiveSyncHealthByUser"
  >,
  input: { accountId: UserId; authSessionId?: string; endedAt: Date },
): Promise<void> {
  await (input.authSessionId
    ? extension.revokeInstallationSessionsByAuthSession(
        input.authSessionId,
        input.endedAt,
      )
    : extension.revokeInstallationSessionsByUser(
        input.accountId,
        input.endedAt,
      ));
  await extension.updateExecutiveSyncHealthByUser({
    user_id: input.accountId,
    sync_health: "reauth_required",
    sync_updated_at: input.endedAt,
  });
}
