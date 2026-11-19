import { BranchId, UserId, WorkspaceId } from "~/domain/ids";
import { hashPassword } from "~/server/auth/password/password";
import {
  createHost,
  type Host,
  type HostStorage,
} from "~/server/composition/host";
import { persistSeedPeople } from "~/server/platform/database/seeds/shared/people";
import { createWorkspace } from "~/server/roles/create-workspace";
import { roleByKey } from "~/server/roles/role-ref";

import { BENCH_NOW } from "./constants";
import { memoryBlobs } from "./memory-blobs";
import { nodeMemoryStores } from "./node-store";

export const BENCH_PASSWORD = "Secret123!";
export const BENCH_WORKSPACE_ID = WorkspaceId.trust(
  "01974fd5-f261-7a7d-93f5-2f3d0f965001",
);
const BRANCH_ID = BranchId.trust("01974fd5-f261-7a7d-93f5-2f3d0f960001");

// A workspace's staff: an admin to act as, and enough executives that member
// lookups read a realistic roster.
const EXECUTIVES = 60;

export interface BenchHost {
  host: Host;
  storage: HostStorage;
  workspaceId: WorkspaceId;
  branchId: BranchId;
  // An admin must pass strong auth to sign in; an executive needs only the
  // password.
  admin: { id: UserId; username: string };
  executives: { id: UserId; username: string }[];
}

// The real host over in-memory `node:sqlite` stores, with one workspace and
// its staff. Each bench file seeds the rows its subject reads on top.
export async function createBenchHost(): Promise<BenchHost> {
  const storage = { openStore: nodeMemoryStores(), openBlobs: memoryBlobs() };
  const host = await createHost(storage);
  const workspaceId = BENCH_WORKSPACE_ID;
  const { db: workspace } = await host.stores.workspace(workspaceId);
  const platform = host.stores.platform.db;

  await createWorkspace(
    { platform, workspace },
    {
      id: workspaceId,
      name: "Bench",
      modules: ["culqi", "contacts"],
      createdAt: BENCH_NOW,
    },
  );
  await workspace
    .insertInto("branches")
    .values({ id: BRANCH_ID, name: "Lima", created_at: BENCH_NOW })
    .execute();

  const passwordHash = await hashPassword(BENCH_PASSWORD);
  const person = (index: number, role: "admin" | "executive") => ({
    id: UserId.mint(),
    branch_id: BRANCH_ID,
    username: `${role}.${index}`,
    email: `${role}.${index}@bench.local`,
    password_hash: passwordHash,
    names: role === "admin" ? "Admin" : `Ejecutivo ${index}`,
    first_surname: "Bench",
    second_surname: "Perú",
    onboarding_completed_at: BENCH_NOW,
    ...roleByKey(role),
    is_active: true,
    created_at: BENCH_NOW,
  });
  const admin = person(0, "admin");
  const executives = Array.from({ length: EXECUTIVES }, (_, index) =>
    person(index + 1, "executive"),
  );
  await persistSeedPeople({ platform, workspaceId, workspace }, [
    admin,
    ...executives,
  ]);

  return {
    host,
    storage,
    workspaceId,
    branchId: BRANCH_ID,
    admin: { id: admin.id, username: admin.username },
    executives: executives.map(({ id, username }) => ({ id, username })),
  };
}
