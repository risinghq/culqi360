import type { SessionInfo } from "~/contracts/auth";
import type { Role } from "~/domain/auth/access/rbac";
import type { UserId, WorkspaceId } from "~/domain/ids";
import type { OperationContext } from "~/server/platform/operation/context";
import type { SessionRepository } from "~/server/sessions/repos-sessions";

export interface MemberPlacement {
  role: Role;
  branchName: string;
}

// Reads the workspace store, which owns role and branch.
export type FindMemberPlacements = (
  accountIds: readonly UserId[],
) => Promise<ReadonlyMap<UserId, MemberPlacement>>;

export async function listAllActiveSessions(
  sessions: Pick<SessionRepository, "listActiveInWorkspace">,
  findPlacements: FindMemberPlacements,
  workspaceId: WorkspaceId,
  operation: OperationContext,
): Promise<SessionInfo[]> {
  const activeSessions = await sessions.listActiveInWorkspace(
    workspaceId,
    operation.operationAt,
  );
  const placements = await findPlacements([
    ...new Set(activeSessions.map((session) => session.accountId)),
  ]);

  return activeSessions.flatMap((session) => {
    // An operator entering for support has a session but no member row.
    const placement = placements.get(session.accountId);
    if (!placement) {
      return [];
    }
    return [
      {
        id: session.id,
        userId: session.accountId,
        userEmail: session.email,
        userName: session.name,
        role: placement.role,
        branchName: placement.branchName,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
        createdAt: session.createdAt.getTime(),
        lastActivity: session.lastActivity.getTime(),
        expiresAt: session.expiresAt.getTime(),
      },
    ];
  });
}
