import { sql, type Kysely } from "kysely";

import { WorkspaceId } from "~/domain/ids";
import { checkCaseTypeDefinition } from "~/server/cases/domain/definition";
import { createCasesRepo } from "~/server/cases/infrastructure/cases-repo";
import type { Database } from "~/server/platform/database/types";
import {
  runAsPlatform,
  WORKSPACE_SETTING,
} from "~/server/platform/database/workspace-scope";

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
        chunk.map((user) => ({
          id: user.id,
          branch_id: user.branchId,
          username: user.username,
          email: user.email,
          password_hash: UNUSABLE_PASSWORD_HASH,
          password_change_required: true,
          names: user.names,
          first_surname: user.firstSurname,
          second_surname: user.secondSurname,
          role: user.role,
          is_active: user.isActive,
          created_at: at,
        })),
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
      await trx
        .insertInto("workspaces")
        .values({
          id: input.workspaceId,
          name: input.workspaceName,
          modules: [],
          created_at: input.at,
        })
        .execute();
      // Transaction-local, so the column defaults tag every row with the new
      // workspace.
      await sql`select set_config(${WORKSPACE_SETTING}, ${input.workspaceId}, true)`.execute(
        trx,
      );
      await insertPlan(trx, input);
    }),
  );
}
