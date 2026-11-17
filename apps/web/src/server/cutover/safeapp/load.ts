import type { Kysely } from "kysely";

import { WorkspaceId } from "~/domain/ids";
import { checkCaseTypeDefinition } from "~/server/cases/domain/definition";
import { createCasesRepo } from "~/server/cases/infrastructure/cases-repo";
import { ENTEL_ROLES } from "~/server/cases/presets/entel";
import type { Database } from "~/server/platform/database/types";
import { runAsPlatform } from "~/server/platform/database/workspace-scope";
import { createWorkspace } from "~/server/roles/create-workspace";
import { roleByKey } from "~/server/roles/role-ref";

import type { CutoverPlan } from "./transform";

// Users must reset a password the cutover never copies. "!" is no argon2
// hash, so it never verifies.
const UNUSABLE_PASSWORD_HASH = "!";
const CHUNK = 500;

export type LoadInput = {
  plan: CutoverPlan;
  workspaceId: WorkspaceId;
  workspaceName: string;
  at: Date;
};

function chunks<T>(rows: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < rows.length; start += CHUNK) {
    out.push(rows.slice(start, start + CHUNK));
  }
  return out;
}

// Usernames and emails are unique across workspaces, so a clash with another
// workspace stops the run before it writes.
async function assertLoadable(
  trx: Kysely<Database>,
  input: LoadInput,
): Promise<void> {
  const workspace = await trx
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
  const clash = await trx
    .selectFrom("users")
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
  trx: Kysely<Database>,
  input: LoadInput,
): Promise<void> {
  const { plan, at } = input;
  if (plan.branches.length > 0) {
    await trx
      .insertInto("branches")
      .values(
        plan.branches.map((branch) => ({
          id: branch.id,
          name: branch.name,
          created_at: at,
        })),
      )
      .execute();
  }
  for (const chunk of chunks(plan.users)) {
    // eslint-disable-next-line no-await-in-loop
    await trx
      .insertInto("users")
      .values(
        chunk.map((user) => {
          const roleRef = roleByKey(user.roleKey);
          return {
            id: user.id,
            branch_id: user.branchId,
            username: user.username,
            email: user.email,
            password_hash: UNUSABLE_PASSWORD_HASH,
            password_change_required: true,
            names: user.names,
            first_surname: user.firstSurname,
            second_surname: user.secondSurname,
            role_id: roleRef.role_id,
            role: roleRef.role,
            is_active: user.isActive,
            created_at: at,
          };
        }),
      )
      .execute();
  }
  for (const chunk of chunks(plan.organizations)) {
    // eslint-disable-next-line no-await-in-loop
    await trx
      .insertInto("organizations")
      .values(
        chunk.map((organization) => ({
          id: organization.id,
          ruc: organization.ruc,
          legal_name: organization.legalName,
          created_at: at,
        })),
      )
      .execute();
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
  trx: Kysely<Database>,
  input: LoadInput,
): Promise<void> {
  const { plan, at } = input;
  if (plan.campaigns.length > 0) {
    await trx
      .insertInto("campaigns")
      .values(
        plan.campaigns.map((campaign) => ({
          id: campaign.id,
          name: campaign.name,
          created_at: at,
        })),
      )
      .execute();
  }
  for (const chunk of chunks(plan.campaignRecords)) {
    // eslint-disable-next-line no-await-in-loop
    await trx
      .insertInto("campaign_records")
      .values(
        chunk.map((record) => ({
          id: record.id,
          campaign_id: record.campaignId,
          organization_id: record.organizationId,
          segment: record.segment,
          facts: record.facts,
          imported_at: at,
          worked_at: record.workedAt,
        })),
      )
      .execute();
  }
  for (const chunk of chunks(plan.campaignHolds)) {
    // eslint-disable-next-line no-await-in-loop
    await trx
      .insertInto("campaign_holds")
      .values(
        chunk.map((hold) => ({
          record_id: hold.recordId,
          user_id: hold.userId,
          held_at: hold.heldAt,
          released_at: hold.releasedAt,
        })),
      )
      .execute();
  }
  for (const chunk of chunks(plan.activities)) {
    // eslint-disable-next-line no-await-in-loop
    await trx
      .insertInto("activities")
      .values(
        chunk.map((activity) => ({
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
      )
      .execute();
  }
}

// Writes the plan as a new workspace in one transaction: a failure leaves no
// part of it behind.
export function loadSafeappCutover(
  db: Kysely<Database>,
  input: LoadInput,
): Promise<void> {
  for (const definition of input.plan.caseTypes) {
    if (!checkCaseTypeDefinition(definition).ok) {
      throw new Error(`entel_case_type_invalid:${definition.key}`);
    }
  }
  return runAsPlatform(() =>
    db.transaction().execute(async (trx) => {
      await assertLoadable(trx, input);
      await createWorkspace(trx, {
        id: input.workspaceId,
        name: input.workspaceName,
        modules: [],
        createdAt: input.at,
        extraRoles: ENTEL_ROLES,
        outcomes: input.plan.outcomes,
      });
      await insertPlan(trx, input);
    }),
  );
}
