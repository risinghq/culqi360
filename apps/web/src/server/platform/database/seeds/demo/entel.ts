import type { Kysely } from "kysely";

import { BranchId, UserId, WorkspaceId } from "~/domain/ids";
import { hashPassword } from "~/server/auth/password/password";
import { checkCaseTypeDefinition } from "~/server/cases/domain/definition";
import { createCasesRepo } from "~/server/cases/infrastructure/cases-repo";
import { ENTEL_ROLES, entelCaseTypes } from "~/server/cases/presets/entel";
import { createWorkspace } from "~/server/roles/create-workspace";
import { roleByKey } from "~/server/roles/role-ref";

import type { Database } from "../../types";
import type { SeedContext } from "../shared/context";
import { resolveInstallationPassword } from "../shared/installation-password";
import { stableSeedId } from "../shared/stable-id";

const ENTEL_WORKSPACE_ID = WorkspaceId.trust(stableSeedId("workspace:entel"));
// Entel's tiendas. A quiebre names one, and only that tienda's supervisor
// validates it.
const TIENDAS = [
  { key: "centro", name: "Tienda Centro" },
  { key: "norte", name: "Tienda Norte" },
  { key: "sur", name: "Tienda Sur" },
] as const;
type Tienda = (typeof TIENDAS)[number]["key"];

const tiendaId = (tienda: Tienda) =>
  BranchId.trust(stableSeedId(`branch:entel-${tienda}`));

// Invented values. Entel's real catalogs load at cutover.
const DEMO_CATALOG = {
  carteras: ["CARTERA A", "CARTERA B"],
  fixedProducts: ["INTERNET 200", "INTERNET 500", "INTERNET + TV"],
};

// `role` is a role key: a baseline kind or one of ENTEL_ROLES.
const ENTEL_USERS: readonly {
  key: string;
  role: string;
  tienda: Tienda;
  names: string;
  firstSurname: string;
  secondSurname: string;
}[] = [
  {
    key: "rosa",
    role: "admin",
    tienda: "centro",
    names: "Rosa",
    firstSurname: "Huaman",
    secondSurname: "Torres",
  },
  {
    key: "luis",
    role: "executive",
    tienda: "centro",
    names: "Luis",
    firstSurname: "Cardenas",
    secondSurname: "Rojas",
  },
  {
    key: "carla",
    role: "executive",
    tienda: "norte",
    names: "Carla",
    firstSurname: "Mendoza",
    secondSurname: "Vega",
  },
  {
    key: "jorge",
    role: "validador",
    tienda: "centro",
    names: "Jorge",
    firstSurname: "Salas",
    secondSurname: "Pinto",
  },
  {
    key: "elena",
    role: "validador",
    tienda: "norte",
    names: "Elena",
    firstSurname: "Quispe",
    secondSurname: "Soto",
  },
  {
    key: "ana",
    role: "back_office",
    tienda: "centro",
    names: "Ana",
    firstSurname: "Flores",
    secondSurname: "Ramos",
  },
  {
    key: "miguel",
    role: "sales_manager",
    tienda: "centro",
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
  await createWorkspace(db, {
    id: ENTEL_WORKSPACE_ID,
    name: "Entel",
    modules: [],
    createdAt: at,
    extraRoles: ENTEL_ROLES,
  });

  await db
    .insertInto("branches")
    .values(
      TIENDAS.map((tienda) => ({
        id: tiendaId(tienda.key),
        name: tienda.name,
        created_at: at,
      })),
    )
    .execute();

  const passwordHash = await hashPassword(resolveInstallationPassword());
  await db
    .insertInto("users")
    .values(
      ENTEL_USERS.map((user) => {
        const username = `${user.key}.${user.firstSurname.toLowerCase()}`;
        const roleRef = roleByKey(user.role);
        return {
          id: UserId.trust(stableSeedId(`user:entel:${user.key}`)),
          branch_id: tiendaId(user.tienda),
          username,
          email: `${username}@entel.demo`,
          password_hash: passwordHash,
          names: user.names,
          first_surname: user.firstSurname,
          second_surname: user.secondSurname,
          onboarding_completed_at: at,
          role_id: roleRef.role_id,
          role: roleRef.role,
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
