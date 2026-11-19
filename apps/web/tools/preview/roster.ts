import type { Kysely } from "kysely";

import type { Role } from "~/domain/auth/access/rbac";
import {
  hashSessionToken,
  sealSessionToken,
} from "~/server/auth/session/tokens";
import { insertBatches } from "~/server/platform/database/batches";
import { INSTALLATION_WORKSPACE_ID } from "~/server/platform/database/seeds/installation/workspace-id";
import type { SeedStores } from "~/server/platform/database/seeds/shared/people";
import type { WorkspaceDatabase } from "~/server/platform/database/types";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type PreviewStores = Pick<
  SeedStores,
  "platform" | "workspaceId" | "workspace"
>;

export interface Persona {
  username: string;
  role: Role;
  token: string;
}

export interface RoleCount {
  role: Role;
  count: number;
}

// Keep preview login tokens stable across reseeds.
function deriveToken(username: string): string {
  const base = username.replace(/[^a-z2-7]/g, "");

  if (!base) {
    throw new Error(
      `username '${username}' has no base32-safe characters to derive a token from`,
    );
  }

  const secret = base.repeat(Math.ceil(32 / base.length)).slice(0, 32);
  return sealSessionToken(INSTALLATION_WORKSPACE_ID, secret);
}

function persona(member: { username: string; role: Role }): Persona {
  return {
    username: member.username,
    role: member.role,
    token: deriveToken(member.username),
  };
}

export async function mintAllSessions(
  stores: PreviewStores,
  now: Date,
): Promise<number> {
  const members = await stores.workspace
    .selectFrom("members")
    .select(["user_id", "username"])
    .where("is_active", "=", true)
    .execute();

  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  const sessions = members.map((member) => ({
    id: hashSessionToken(deriveToken(member.username)),
    user_id: member.user_id,
    session_class: "app" as const,
    primary_auth_method: "password" as const,
    strong_auth_method: null,
    strong_auth_at: null,
    impersonator_user_id: null,
    ip_address: "127.0.0.1",
    user_agent: "preview",
    created_at: now,
    last_activity: now,
    expires_at: expiresAt,
  }));

  await stores.workspace.transaction().execute(async (trx) => {
    for (const batch of insertBatches(sessions)) {
      // eslint-disable-next-line no-await-in-loop
      await trx.insertInto("user_sessions").values(batch).execute();
    }
  });

  return members.length;
}

export async function listRoles(
  workspace: Kysely<WorkspaceDatabase>,
): Promise<RoleCount[]> {
  const rows = await workspace
    .selectFrom("members")
    .select(({ fn }) => ["role", fn.countAll<number>().as("count")])
    .where("is_active", "=", true)
    .groupBy("role")
    .orderBy("role")
    .execute();

  return rows;
}

async function activeMember(
  workspace: Kysely<WorkspaceDatabase>,
  column: "username" | "user_id" | "role",
  value: string,
): Promise<Persona | null> {
  const member = await workspace
    .selectFrom("members")
    .select(["username", "role"])
    .where(column, "=", value)
    .where("is_active", "=", true)
    .orderBy("username")
    .executeTakeFirst();

  return member ? persona(member) : null;
}

// The executive who owns the most companies, so the persona has demo data.
async function widestExecutivePortfolio(
  workspace: Kysely<WorkspaceDatabase>,
): Promise<string | null> {
  const row = await workspace
    .selectFrom("organization_current_owners")
    .select("executive_id")
    .groupBy("executive_id")
    .orderBy((eb) => eb.fn.countAll(), "desc")
    .limit(1)
    .executeTakeFirst();

  return row?.executive_id ?? null;
}

export async function resolvePersonaByUsername(
  workspace: Kysely<WorkspaceDatabase>,
  username: string,
): Promise<Persona> {
  const found = await activeMember(workspace, "username", username);

  if (!found) {
    throw new Error(`no active member named '${username}' in the preview`);
  }

  return found;
}

export async function resolvePersonaByRole(
  workspace: Kysely<WorkspaceDatabase>,
  role: Role,
): Promise<Persona> {
  if (role === "executive") {
    const widestId = await widestExecutivePortfolio(workspace);
    const widest =
      widestId && (await activeMember(workspace, "user_id", widestId));

    if (widest) {
      return widest;
    }
  }

  const found = await activeMember(workspace, "role", role);

  if (!found) {
    throw new Error(`no active '${role}' member in the preview`);
  }

  return found;
}
