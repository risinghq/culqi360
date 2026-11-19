import type { Kysely } from "kysely";

import { newRowId, type WorkspaceId } from "~/domain/ids";
import { checkCaseTypeDefinition } from "~/server/cases/domain/definition";
import { createCasesRepo } from "~/server/cases/infrastructure/cases-repo";
import { ENTEL_ROLES } from "~/server/cases/presets/entel";
import { insertBatches } from "~/server/platform/database/batches";
import { persistSeedPeople } from "~/server/platform/database/seeds/shared/people";
import type {
  PlatformDatabase,
  WorkspaceDatabase,
} from "~/server/platform/database/types";
import { createWorkspace } from "~/server/roles/create-workspace";
import { roleByKey } from "~/server/roles/role-ref";

import type { CutoverPlan } from "./transform";

// Users must reset a password the cutover never copies. "!" is no argon2
// hash, so it never verifies.
const UNUSABLE_PASSWORD_HASH = "!";

export type CutoverStores = {
  platform: Kysely<PlatformDatabase>;
  workspace: Kysely<WorkspaceDatabase>;
};

export type LoadInput = {
  plan: CutoverPlan;
  workspaceId: WorkspaceId;
  workspaceName: string;
  at: Date;
};

// Usernames and emails are unique across workspaces, so a clash with another
// workspace stops the run before it writes.
async function assertLoadable(
  platform: Kysely<PlatformDatabase>,
  input: LoadInput,
): Promise<void> {
  const workspace = await platform
    .selectFrom("workspaces")
    .select("id")
    .where((eb) =>
      eb.or([
        eb("id", "=", input.workspaceId),
        eb("name", "=", input.workspaceName),
      ]),
    )
    .executeTakeFirst();
  if (workspace) {
    throw new Error("cutover_workspace_exists");
  }
  const { users } = input.plan;
  if (users.length === 0) {
    return;
  }
  const clash = await platform
    .selectFrom("accounts")
    .select("id")
    .where((eb) =>
      eb.or([
        eb(
          "username",
          "in",
          users.map((user) => user.username),
        ),
        eb(
          "email",
          "in",
          users.map((user) => user.email),
        ),
      ]),
    )
    .limit(1)
    .executeTakeFirst();
  if (clash) {
    throw new Error("cutover_user_exists");
  }
}

async function insertPlan(
  platform: Kysely<PlatformDatabase>,
  trx: Kysely<WorkspaceDatabase>,
  input: LoadInput,
): Promise<void> {
  const { plan, at } = input;
  const branches = plan.branches.map((branch) => ({
    id: branch.id,
    name: branch.name,
    created_at: at,
  }));
  for (const batch of insertBatches(branches)) {
    // eslint-disable-next-line no-await-in-loop
    await trx.insertInto("branches").values(batch).execute();
  }
  await persistSeedPeople(
    { platform, workspaceId: input.workspaceId, workspace: trx },
    plan.users.map((user) => ({
      id: user.id,
      branch_id: user.branchId,
      username: user.username,
      email: user.email,
      password_hash: UNUSABLE_PASSWORD_HASH,
      password_change_required: true,
      names: user.names,
      first_surname: user.firstSurname,
      second_surname: user.secondSurname,
      onboarding_completed_at: null,
      ...roleByKey(user.roleKey),
      is_active: user.isActive,
      created_at: at,
    })),
  );
  const organizations = plan.organizations.map((organization) => ({
    id: organization.id,
    ruc: organization.ruc,
    legal_name: organization.legalName,
    created_at: at,
  }));
  for (const batch of insertBatches(organizations)) {
    // eslint-disable-next-line no-await-in-loop
    await trx.insertInto("organizations").values(batch).execute();
  }

  const cases = createCasesRepo(trx);
  for (const definition of plan.caseTypes) {
    // eslint-disable-next-line no-await-in-loop
    const caseTypeId = await cases.insertCaseType(definition, at);
    // eslint-disable-next-line no-await-in-loop
    await cases.importCases(
      caseTypeId,
      plan.cases.filter((each) => each.caseTypeKey === definition.key),
    );
  }
  await insertCampaigns(trx, input);
}

async function insertCampaigns(
  trx: Kysely<WorkspaceDatabase>,
  input: LoadInput,
): Promise<void> {
  const { plan, at } = input;
  const campaigns = plan.campaigns.map((campaign) => ({
    id: campaign.id,
    name: campaign.name,
    created_at: at,
  }));
  for (const batch of insertBatches(campaigns)) {
    // eslint-disable-next-line no-await-in-loop
    await trx.insertInto("campaigns").values(batch).execute();
  }
  const records = plan.campaignRecords.map((record) => ({
    id: record.id,
    campaign_id: record.campaignId,
    organization_id: record.organizationId,
    segment: record.segment,
    facts: record.facts,
    imported_at: at,
    worked_at: record.workedAt,
  }));
  for (const batch of insertBatches(records)) {
    // eslint-disable-next-line no-await-in-loop
    await trx.insertInto("campaign_records").values(batch).execute();
  }
  const holds = plan.campaignHolds.map((hold) => ({
    id: newRowId(),
    record_id: hold.recordId,
    user_id: hold.userId,
    held_at: hold.heldAt,
    released_at: hold.releasedAt,
  }));
  for (const batch of insertBatches(holds)) {
    // eslint-disable-next-line no-await-in-loop
    await trx.insertInto("campaign_holds").values(batch).execute();
  }
  const activities = plan.activities.map((activity) => ({
    id: activity.id,
    channel: activity.channel,
    user_id: activity.userId,
    branch_id: activity.branchId,
    organization_id: activity.organizationId,
    campaign_record_id: activity.campaignRecordId,
    phone: activity.phone,
    source: "import" as const,
    started_at: activity.startedAt,
    outcome_id: activity.outcomeId,
    notes: activity.notes,
  }));
  for (const batch of insertBatches(activities)) {
    // eslint-disable-next-line no-await-in-loop
    await trx.insertInto("activities").values(batch).execute();
  }
}

// Writes the plan as a new workspace into an empty workspace store. The
// workspace rows land in one transaction, but the platform's accounts and
// memberships sit in another store: a run that fails partway leaves accounts
// and a listed workspace to delete before the next run.
export async function loadSafeappCutover(
  stores: CutoverStores,
  input: LoadInput,
): Promise<void> {
  for (const definition of input.plan.caseTypes) {
    if (!checkCaseTypeDefinition(definition).ok) {
      throw new Error(`entel_case_type_invalid:${definition.key}`);
    }
  }
  await assertLoadable(stores.platform, input);
  await createWorkspace(stores, {
    id: input.workspaceId,
    name: input.workspaceName,
    modules: [],
    createdAt: input.at,
    extraRoles: ENTEL_ROLES,
    outcomes: input.plan.outcomes,
  });
  await stores.workspace
    .transaction()
    .execute((trx) => insertPlan(stores.platform, trx, input));
}
