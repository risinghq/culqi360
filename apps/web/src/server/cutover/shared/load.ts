import type { Kysely } from "kysely";

import { newRowId, type WorkspaceId } from "~/domain/ids";
import { UNUSABLE_PASSWORD_HASH } from "~/server/auth/password/password";
import { checkCaseTypeDefinition } from "~/server/cases/domain/definition";
import { createCasesRepo } from "~/server/cases/infrastructure/cases-repo";
import { insertBatches, listBatches } from "~/server/platform/database/batches";
import { persistSeedPeople } from "~/server/platform/database/seeds/shared/people";
import type {
  PlatformDatabase,
  WorkspaceDatabase,
} from "~/server/platform/database/types";
import { createWorkspace } from "~/server/roles/create-workspace";
import { roleByKey } from "~/server/roles/role-ref";

import type { CutoverPlan } from "./plan";

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
  const checks = [
    ["username", input.plan.users.map((user) => user.username)],
    ["email", input.plan.users.map((user) => user.email)],
  ] as const;
  for (const [column, values] of checks) {
    for (const batch of listBatches(values)) {
      // eslint-disable-next-line no-await-in-loop
      const taken = await platform
        .selectFrom("accounts")
        .select(column)
        .where(column, "in", batch)
        .execute();
      if (taken.length > 0) {
        throw new Error(`cutover_${column}_taken:${taken.length}`);
      }
    }
  }
}

async function insertRows<T extends object>(
  rows: readonly T[],
  insert: (batch: T[]) => Promise<unknown>,
): Promise<void> {
  for (const batch of insertBatches([...rows])) {
    // eslint-disable-next-line no-await-in-loop
    await insert(batch);
  }
}

async function insertPeople(
  platform: Kysely<PlatformDatabase>,
  trx: Kysely<WorkspaceDatabase>,
  input: LoadInput,
): Promise<void> {
  const { plan, at } = input;
  await insertRows(
    plan.branches.map((branch) => ({
      id: branch.id,
      name: branch.name,
      created_at: at,
    })),
    (batch) => trx.insertInto("branches").values(batch).execute(),
  );
  await insertRows(
    plan.teams.map((team) => ({
      id: team.id,
      branch_id: team.branchId,
      name: team.name,
      created_at: at,
    })),
    (batch) => trx.insertInto("teams").values(batch).execute(),
  );
  await persistSeedPeople(
    { platform, workspaceId: input.workspaceId, workspace: trx },
    plan.users.map((user) =>
      Object.assign(roleByKey(user.roleKey), {
        id: user.id,
        branch_id: user.branchId,
        team_id: user.teamId,
        username: user.username,
        email: user.email,
        password_hash: UNUSABLE_PASSWORD_HASH,
        password_change_required: true,
        names: user.names,
        first_surname: user.firstSurname,
        second_surname: user.secondSurname,
        onboarding_completed_at: null,
        is_active: user.isActive,
        created_at: at,
      }),
    ),
  );
}

async function insertCases(
  trx: Kysely<WorkspaceDatabase>,
  input: LoadInput,
): Promise<void> {
  const { plan, at } = input;
  await insertRows(
    plan.organizations.map((organization) => ({
      id: organization.id,
      ruc: organization.ruc,
      legal_name: organization.legalName,
      district: organization.district,
      phone: organization.phone,
      created_at: at,
    })),
    (batch) => trx.insertInto("organizations").values(batch).execute(),
  );
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
}

async function insertCampaigns(
  trx: Kysely<WorkspaceDatabase>,
  input: LoadInput,
): Promise<void> {
  const { plan, at } = input;
  await insertRows(
    plan.campaigns.map((campaign) => ({
      id: campaign.id,
      name: campaign.name,
      created_at: at,
    })),
    (batch) => trx.insertInto("campaigns").values(batch).execute(),
  );
  await insertRows(
    plan.campaignRecords.map((record) => ({
      id: record.id,
      campaign_id: record.campaignId,
      organization_id: record.organizationId,
      segment: record.segment,
      facts: record.facts,
      imported_at: at,
      worked_at: record.workedAt,
    })),
    (batch) => trx.insertInto("campaign_records").values(batch).execute(),
  );
  await insertRows(
    plan.campaignHolds.map((hold) => ({
      id: newRowId(),
      record_id: hold.recordId,
      user_id: hold.userId,
      held_at: hold.heldAt,
      released_at: hold.releasedAt,
    })),
    (batch) => trx.insertInto("campaign_holds").values(batch).execute(),
  );
  await insertRows(
    plan.activities.map((activity) => ({
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
    })),
    (batch) => trx.insertInto("activities").values(batch).execute(),
  );
}

// Writes the plan as a new workspace into an empty workspace store. The
// workspace rows land in one transaction, but the platform's accounts and
// memberships sit in another store: a run that fails partway leaves accounts
// and a listed workspace to delete before the next run.
export async function loadCutover(
  stores: CutoverStores,
  input: LoadInput,
): Promise<void> {
  for (const definition of input.plan.caseTypes) {
    if (!checkCaseTypeDefinition(definition).ok) {
      throw new Error(`cutover_case_type_invalid:${definition.key}`);
    }
  }
  await assertLoadable(stores.platform, input);
  await createWorkspace(stores, {
    id: input.workspaceId,
    name: input.workspaceName,
    modules: [],
    createdAt: input.at,
    extraRoles: input.plan.roles,
    outcomes: input.plan.outcomes,
  });
  await stores.workspace.transaction().execute(async (trx) => {
    await insertPeople(stores.platform, trx, input);
    await insertCases(trx, input);
    await insertCampaigns(trx, input);
  });
}
