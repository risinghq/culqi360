import { createEventsWriter } from "~/server/event-logs/events-repo";
import { createExtensionRuntimeRepo } from "~/server/extension/repos";
import type { WorkspaceExecutor } from "~/server/platform/database/executor";
import { createExecutorUow } from "~/server/platform/database/uow";
import { createRolesRepo } from "~/server/roles/repos-roles";
import type {
  MemberAccountsPort,
  MemberWriteDeps,
} from "~/server/users/application/ports";
import { createMemberWorkloadRepo } from "~/server/users/repos-member-workload";
import { createMembersRepo } from "~/server/users/repos-members";

export function createMemberWriteContext(
  db: WorkspaceExecutor,
  accounts: MemberAccountsPort,
): MemberWriteDeps {
  return {
    members: createMembersRepo(db),
    lifecycle: createExecutorUow(db, (tx) => ({
      members: createMembersRepo(tx),
      roles: createRolesRepo(tx),
      workload: createMemberWorkloadRepo(tx),
      extension: createExtensionRuntimeRepo(tx),
      events: createEventsWriter(tx),
    })),
    accounts,
  };
}
