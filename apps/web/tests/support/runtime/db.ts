import { Database } from "bun:sqlite";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import type { Kysely } from "kysely";

import {
  BranchId,
  ContactId,
  OrganizationId,
  PersonId,
  UserId,
  WorkspaceId,
} from "~/domain/ids";
import type { AuthWorkspaces } from "~/server/auth/application/ports";
import {
  createAuthWorkspace,
  routeAuthWorkspaces,
} from "~/server/auth/infrastructure/workspace-port";
import { ENTEL_ROLES } from "~/server/cases/presets/entel";
import {
  bunSqliteStore,
  createBunSqliteStore,
  openBunDatabase,
} from "~/server/platform/database/bun-store";
import type { CommitEffects } from "~/server/platform/database/commit-effects";
import {
  openPlatformStore,
  openRegistryStore,
  openWorkspaceStore,
  type OpenedWorkspaceStore,
} from "~/server/platform/database/open-store";
import { persistSeedPeople } from "~/server/platform/database/seeds/shared/people";
import type {
  PlatformDatabase,
  RegistryDatabase,
  WorkspaceDatabase,
} from "~/server/platform/database/types";
import { createWorkspace } from "~/server/roles/create-workspace";
import { roleByKey } from "~/server/roles/role-ref";

import { withPlanCheck } from "./plan-check";
import { createTestRepositories, type TestRepositories } from "./repos";

const TEST_WORKSPACE_ID = WorkspaceId.trust(
  "01974fd5-f261-7a7d-93f5-2f3d0f965001",
);

const TEST_ORG_ID_LIMA = OrganizationId.trust(
  "01974fd5-f261-7a7d-93f5-2f3d0f963001",
);
const TEST_ORG_ID_NORTE = OrganizationId.trust(
  "01974fd5-f261-7a7d-93f5-2f3d0f963002",
);

const BRANCH_LIMA_ID = BranchId.trust("01974fd5-f261-7a7d-93f5-2f3d0f960001");
const BRANCH_NORTE_ID = BranchId.trust("01974fd5-f261-7a7d-93f5-2f3d0f960002");

const USER_EXEC_ONE_ID = UserId.trust("01974fd5-f261-7a7d-93f5-2f3d0f961001");
const USER_BACK_ONE_ID = UserId.trust("01974fd5-f261-7a7d-93f5-2f3d0f961002");
const USER_EXEC_TWO_ID = UserId.trust("01974fd5-f261-7a7d-93f5-2f3d0f961003");
const USER_BACK_TWO_ID = UserId.trust("01974fd5-f261-7a7d-93f5-2f3d0f961004");
const USER_SUPER_ID = UserId.trust("01974fd5-f261-7a7d-93f5-2f3d0f961005");

const PERSON_LIMA_ID = PersonId.trust("01974fd5-f261-7a7d-93f5-2f3d0f962001");
const PERSON_NORTE_ID = PersonId.trust("01974fd5-f261-7a7d-93f5-2f3d0f962002");

const CONTACT_LIMA_ID = ContactId.trust("01974fd5-f261-7a7d-93f5-2f3d0f964001");
const CONTACT_NORTE_ID = ContactId.trust(
  "01974fd5-f261-7a7d-93f5-2f3d0f964002",
);

export const TEST_FIXTURES = {
  workspace: { id: TEST_WORKSPACE_ID },
  branches: {
    lima: { id: BRANCH_LIMA_ID },
    norte: { id: BRANCH_NORTE_ID },
  },
  users: {
    execOne: { id: USER_EXEC_ONE_ID, branchId: BRANCH_LIMA_ID },
    backOne: { id: USER_BACK_ONE_ID, branchId: BRANCH_LIMA_ID },
    execTwo: { id: USER_EXEC_TWO_ID, branchId: BRANCH_NORTE_ID },
    backTwo: { id: USER_BACK_TWO_ID, branchId: BRANCH_NORTE_ID },
    superUser: { id: USER_SUPER_ID, branchId: BRANCH_NORTE_ID },
  },
  organizations: {
    lima: { id: TEST_ORG_ID_LIMA, ruc: "20100000001" },
    norte: { id: TEST_ORG_ID_NORTE, ruc: "20100000002" },
  },
  people: {
    lima: { id: PERSON_LIMA_ID, dni: "70000001" },
    norte: { id: PERSON_NORTE_ID, dni: "70000002" },
  },
  contacts: {
    lima: { id: CONTACT_LIMA_ID },
    norte: { id: CONTACT_NORTE_ID },
  },
} as const;

export interface TestStoreSet {
  platform: Kysely<PlatformDatabase>;
  registry: Kysely<RegistryDatabase>;
  workspace: Kysely<WorkspaceDatabase>;
}

// The fixture workspace holds Entel's roles too, because the Entel case types
// name the validador as a stage owner and a stage owner must be a role of the
// workspace.
export function insertTestWorkspace(stores: {
  platform: Kysely<PlatformDatabase>;
  workspace: Kysely<WorkspaceDatabase>;
}): Promise<void> {
  return createWorkspace(stores, {
    id: TEST_WORKSPACE_ID,
    name: "Test",
    modules: ["culqi", "contacts"],
    extraRoles: ENTEL_ROLES,
    createdAt: new Date(),
  });
}

function person(
  id: UserId,
  branchId: BranchId,
  identity: {
    username: string;
    email: string;
    names: string;
    firstSurname: string;
    secondSurname: string;
    role: "executive" | "back_office" | "superuser";
  },
  now: Date,
) {
  return {
    id,
    branch_id: branchId,
    username: identity.username,
    email: identity.email,
    password_hash: "hash",
    names: identity.names,
    first_surname: identity.firstSurname,
    second_surname: identity.secondSurname,
    onboarding_completed_at: now,
    ...roleByKey(identity.role),
    is_active: true,
    created_at: now,
  };
}

async function seedFixtures(stores: TestStoreSet): Promise<void> {
  const now = new Date();
  await insertTestWorkspace(stores);
  const db = stores.workspace;

  await db
    .insertInto("branches")
    .values([
      { id: BRANCH_LIMA_ID, name: "Lima", created_at: now },
      { id: BRANCH_NORTE_ID, name: "Norte", created_at: now },
    ])
    .execute();

  await persistSeedPeople(
    {
      platform: stores.platform,
      workspaceId: TEST_WORKSPACE_ID,
      workspace: db,
    },
    [
      person(
        USER_EXEC_ONE_ID,
        BRANCH_LIMA_ID,
        {
          username: "exec.one",
          email: "exec1@test.local",
          names: "Exec",
          firstSurname: "One",
          secondSurname: "Alpha",
          role: "executive",
        },
        now,
      ),
      person(
        USER_BACK_ONE_ID,
        BRANCH_LIMA_ID,
        {
          username: "back.one",
          email: "back1@test.local",
          names: "Back",
          firstSurname: "One",
          secondSurname: "Alpha",
          role: "back_office",
        },
        now,
      ),
      person(
        USER_EXEC_TWO_ID,
        BRANCH_NORTE_ID,
        {
          username: "exec.two",
          email: "exec2@test.local",
          names: "Exec",
          firstSurname: "Two",
          secondSurname: "Beta",
          role: "executive",
        },
        now,
      ),
      person(
        USER_BACK_TWO_ID,
        BRANCH_NORTE_ID,
        {
          username: "back.two",
          email: "back2@test.local",
          names: "Back",
          firstSurname: "Two",
          secondSurname: "Beta",
          role: "back_office",
        },
        now,
      ),
      person(
        USER_SUPER_ID,
        BRANCH_NORTE_ID,
        {
          username: "super.user",
          email: "super@test.local",
          names: "Super",
          firstSurname: "User",
          secondSurname: "Gamma",
          role: "superuser",
        },
        now,
      ),
    ],
  );

  await db
    .insertInto("organizations")
    .values([
      {
        id: TEST_ORG_ID_LIMA,
        ruc: "20100000001",
        legal_name: "Org Lima",
        created_at: now,
      },
      {
        id: TEST_ORG_ID_NORTE,
        ruc: "20100000002",
        legal_name: "Org Norte",
        created_at: now,
      },
    ])
    .execute();

  await db
    .insertInto("people")
    .values([
      {
        id: PERSON_LIMA_ID,
        dni: "70000001",
        names: "Contacto",
        first_surname: "Lima",
        second_surname: null,
        email: null,
        created_at: now,
        updated_at: now,
      },
      {
        id: PERSON_NORTE_ID,
        dni: "70000002",
        names: "Contacto",
        first_surname: "Norte",
        second_surname: null,
        email: null,
        created_at: now,
        updated_at: now,
      },
    ])
    .execute();

  await db
    .insertInto("contacts")
    .values([
      {
        id: CONTACT_LIMA_ID,
        person_id: PERSON_LIMA_ID,
        organization_id: TEST_ORG_ID_LIMA,
        phone: "999999111",
        email: null,
        created_at: now,
        updated_at: now,
      },
      {
        id: CONTACT_NORTE_ID,
        person_id: PERSON_NORTE_ID,
        organization_id: TEST_ORG_ID_NORTE,
        phone: "999999222",
        email: null,
        created_at: now,
        updated_at: now,
      },
    ])
    .execute();
}

// A migrated, seeded store in serialized form. Each test file copies it, and
// resetTestDb copies it again, which is cheaper than migrating and seeding.
interface Template {
  platform: Uint8Array;
  registry: Uint8Array;
  workspace: Uint8Array;
}

let templatePromise: Promise<Template> | null = null;

async function buildTemplate(): Promise<Template> {
  const files = {
    platform: openBunDatabase(new Database(":memory:", { strict: true })),
    registry: openBunDatabase(new Database(":memory:", { strict: true })),
    workspace: openBunDatabase(new Database(":memory:", { strict: true })),
  };
  try {
    const platform = await openPlatformStore(
      bunSqliteStore(() => files.platform),
    );
    const registry = await openRegistryStore(
      bunSqliteStore(() => files.registry),
    );
    const { db: workspace } = await openWorkspaceStore(
      bunSqliteStore(() => files.workspace),
    );
    await seedFixtures({ platform, registry, workspace });
    return {
      platform: files.platform.serialize(),
      registry: files.registry.serialize(),
      workspace: files.workspace.serialize(),
    };
  } finally {
    files.platform.close();
    files.registry.close();
    files.workspace.close();
  }
}

function template(): Promise<Template> {
  templatePromise ??= buildTemplate().catch((error: unknown) => {
    templatePromise = null;
    throw error;
  });
  return templatePromise;
}

// One store whose database a reset replaces with a fresh copy of the
// template, so the Kysely instance built on it stays valid.
function copyableStore(bytes: Uint8Array) {
  const copy = () =>
    openBunDatabase(Database.deserialize(bytes, { strict: true }));
  let current = copy();
  return {
    store: withPlanCheck(
      bunSqliteStore(() => current),
      bytes,
    ),
    reset() {
      current.close();
      current = copy();
    },
    close() {
      current.close();
    },
  };
}

export interface TestDbContext {
  storageRoot: string;
  platform: Kysely<PlatformDatabase>;
  registry: Kysely<RegistryDatabase>;
  // The fixture workspace's store.
  db: Kysely<WorkspaceDatabase>;
  effects: CommitEffects;
  // The store of another workspace, empty until a test fills it. It lasts
  // until the next reset.
  workspace(id: WorkspaceId): Promise<OpenedWorkspaceStore>;
  // The platform's view of member data, over the stores above.
  authWorkspaces: AuthWorkspaces;
  repos: TestRepositories;
  fixtures: typeof TEST_FIXTURES;
  reset(): void;
  close(): void;
}

export async function createIsolatedTestDb(
  prefix: string,
): Promise<TestDbContext> {
  const bytes = await template();
  const platformFile = copyableStore(bytes.platform);
  const registryFile = copyableStore(bytes.registry);
  const workspaceFile = copyableStore(bytes.workspace);
  const platform = await openPlatformStore(platformFile.store);
  const registry = await openRegistryStore(registryFile.store);
  const { db, effects } = await openWorkspaceStore(workspaceFile.store);

  const others = new Map<
    WorkspaceId,
    {
      file: ReturnType<typeof createBunSqliteStore>;
      opened: Promise<OpenedWorkspaceStore>;
    }
  >();
  const closeOthers = () => {
    for (const other of others.values()) {
      other.file.close();
    }
    others.clear();
  };

  function workspace(id: WorkspaceId): Promise<OpenedWorkspaceStore> {
    if (id === TEST_WORKSPACE_ID) {
      return Promise.resolve({ db, effects });
    }
    let other = others.get(id);
    if (!other) {
      const file = createBunSqliteStore();
      other = {
        file,
        opened: openWorkspaceStore(withPlanCheck(file, bytes.workspace)),
      };
      others.set(id, other);
    }
    return other.opened;
  }

  const runId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  return {
    storageRoot: join(process.cwd(), ".vitest-files", `${prefix}-${runId}`),
    platform,
    registry,
    db,
    effects,
    workspace,
    authWorkspaces: routeAuthWorkspaces(async (id) =>
      createAuthWorkspace((await workspace(id)).db),
    ),
    repos: createTestRepositories({ platform, registry, db }),
    fixtures: TEST_FIXTURES,
    reset() {
      platformFile.reset();
      registryFile.reset();
      workspaceFile.reset();
      closeOthers();
    },
    close() {
      platformFile.close();
      registryFile.close();
      workspaceFile.close();
      closeOthers();
    },
  };
}

// Reset each case, not once per test file.
export function resetTestDb(ctx: TestDbContext): Promise<void> {
  ctx.reset();
  return Promise.resolve();
}

export async function cleanupTestDb(
  ctx: TestDbContext | null | undefined,
): Promise<void> {
  if (!ctx) {
    return;
  }
  ctx.close();
  await rm(ctx.storageRoot, { force: true, recursive: true });
}

export interface FreshStores {
  platform: Kysely<PlatformDatabase>;
  registry: Kysely<RegistryDatabase>;
  // Each workspace id gets its own empty store on first use.
  workspace: (id: WorkspaceId) => Promise<Kysely<WorkspaceDatabase>>;
  authWorkspaces: AuthWorkspaces;
  close(): void;
}

// Migrated stores with no rows, for seeding tests.
export async function createFreshStores(): Promise<FreshStores> {
  const bytes = await template();
  const platformFile = createBunSqliteStore();
  const registryFile = createBunSqliteStore();
  const platform = await openPlatformStore(
    withPlanCheck(platformFile, bytes.platform),
  );
  const registry = await openRegistryStore(
    withPlanCheck(registryFile, bytes.registry),
  );

  const workspaces = new Map<
    WorkspaceId,
    {
      file: ReturnType<typeof createBunSqliteStore>;
      db: Promise<Kysely<WorkspaceDatabase>>;
    }
  >();
  function workspace(id: WorkspaceId): Promise<Kysely<WorkspaceDatabase>> {
    let entry = workspaces.get(id);
    if (!entry) {
      const file = createBunSqliteStore();
      entry = {
        file,
        db: openWorkspaceStore(withPlanCheck(file, bytes.workspace)).then(
          ({ db }) => db,
        ),
      };
      workspaces.set(id, entry);
    }
    return entry.db;
  }

  return {
    platform,
    registry,
    workspace,
    authWorkspaces: routeAuthWorkspaces(async (id) =>
      createAuthWorkspace(await workspace(id)),
    ),
    close() {
      platformFile.close();
      registryFile.close();
      for (const entry of workspaces.values()) {
        entry.file.close();
      }
      workspaces.clear();
    },
  };
}
