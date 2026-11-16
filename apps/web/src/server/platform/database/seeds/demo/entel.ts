import { sql, type Kysely } from "kysely";

import type { Role } from "~/domain/auth/access/rbac";
import { BranchId, UserId, WorkspaceId } from "~/domain/ids";
import { hashPassword } from "~/server/auth/password/password";
import { checkCaseTypeDefinition } from "~/server/cases/domain/definition";
import { createCasesRepo } from "~/server/cases/infrastructure/cases-repo";
import { entelCaseTypes } from "~/server/cases/presets/entel";

import type { Database } from "../../types";
import { WORKSPACE_SETTING } from "../../workspace-scope";
import type { SeedContext } from "../shared/context";
import { resolveInstallationPassword } from "../shared/installation-password";
import { stableSeedId } from "../shared/stable-id";

const ENTEL_WORKSPACE_ID = WorkspaceId.trust(stableSeedId("workspace:entel"));
const ENTEL_BRANCH = BranchId.trust(stableSeedId("branch:entel-lima"));

// Invented values. Entel's real catalogs load at cutover.
const DEMO_CATALOG = {
  zonales: ["TIENDA CENTRO", "TIENDA NORTE", "TIENDA SUR"],
  carteras: ["CARTERA A", "CARTERA B"],
  fixedProducts: ["INTERNET 200", "INTERNET 500", "INTERNET + TV"],
};

const ENTEL_USERS: readonly {
  key: string;
  role: Role;
  names: string;
  firstSurname: string;
  secondSurname: string;
}[] = [
  {
    key: "rosa",
    role: "admin",
    names: "Rosa",
    firstSurname: "Huaman",
    secondSurname: "Torres",
  },
  {
    key: "luis",
    role: "executive",
    names: "Luis",
    firstSurname: "Cardenas",
    secondSurname: "Rojas",
  },
  {
    key: "carla",
    role: "executive",
    names: "Carla",
    firstSurname: "Mendoza",
    secondSurname: "Vega",
  },
  {
    key: "jorge",
    role: "supervisor",
    names: "Jorge",
    firstSurname: "Salas",
    secondSurname: "Pinto",
  },
  {
    key: "ana",
    role: "back_office",
    names: "Ana",
    firstSurname: "Flores",
    secondSurname: "Ramos",
  },
  {
    key: "miguel",
    role: "sales_manager",
    names: "Miguel",
    firstSurname: "Chavez",
    secondSurname: "Lopez",
  },
];

// A second workspace for development, set up as Entel's process: one user per
// role and the Entel case types. Every row after the workspace takes the
// Entel scope, so the caller's transaction must not write Culqi rows after
// this stage.
export async function persistEntelWorkspace(
  db: Kysely<Database>,
  context: SeedContext,
): Promise<void> {
  const at = context.anchorDate;
  await db
    .insertInto("workspaces")
    .values({
      id: ENTEL_WORKSPACE_ID,
      name: "Entel",
      modules: [],
      created_at: at,
    })
    .execute();
  await sql`select set_config(${WORKSPACE_SETTING}, ${ENTEL_WORKSPACE_ID}, true)`.execute(
    db,
  );

  await db
    .insertInto("branches")
    .values({ id: ENTEL_BRANCH, name: "Lima", created_at: at })
    .execute();

  const passwordHash = await hashPassword(resolveInstallationPassword());
  await db
    .insertInto("users")
    .values(
      ENTEL_USERS.map((user) => {
        const username = `${user.key}.${user.firstSurname.toLowerCase()}`;
        return {
          id: UserId.trust(stableSeedId(`user:entel:${user.key}`)),
          branch_id: ENTEL_BRANCH,
          username,
          email: `${username}@entel.demo`,
          password_hash: passwordHash,
          names: user.names,
          first_surname: user.firstSurname,
          second_surname: user.secondSurname,
          onboarding_completed_at: at,
          role: user.role,
          is_active: true,
          created_at: at,
        };
      }),
    )
    .execute();

  const definitions = entelCaseTypes(DEMO_CATALOG);
  for (const definition of definitions) {
    if (!checkCaseTypeDefinition(definition).ok) {
      throw new Error(`entel_case_type_invalid:${definition.key}`);
    }
  }
  const cases = createCasesRepo(db);
  await Promise.all(
    definitions.map((definition) => cases.insertCaseType(definition, at)),
  );
}
