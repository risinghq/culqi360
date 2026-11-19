import type { Kysely } from "kysely";

import {
  AuthLoginFlowId,
  type UserId,
  type WebauthnChallengeId,
} from "~/domain/ids";
import type { PlatformDatabase } from "~/server/platform/database/types";

export function createLoginFlowsRepo(db: Kysely<PlatformDatabase>) {
  return {
    async create(values: {
      identifier: string;
      primary_auth_method: "password" | "google" | "passkey";
      account_id?: UserId | null;
      challenge_id?: WebauthnChallengeId | null;
      state: "totp" | "passkey";
      expires_at: Date;
      created_at: Date;
    }): Promise<AuthLoginFlowId> {
      const id = AuthLoginFlowId.mint();
      await db
        .insertInto("login_flows")
        .values({
          id,
          identifier: values.identifier,
          primary_auth_method: values.primary_auth_method,
          account_id: values.account_id ?? null,
          challenge_id: values.challenge_id ?? null,
          state: values.state,
          expires_at: values.expires_at,
          created_at: values.created_at,
          updated_at: values.created_at,
        })
        .execute();
      return id;
    },

    // The platform store runs one request at a time, so a read inside a
    // transaction already sees no concurrent writer.
    findById(id: AuthLoginFlowId) {
      return db
        .selectFrom("login_flows")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst();
    },

    async delete(id: AuthLoginFlowId): Promise<void> {
      await db.deleteFrom("login_flows").where("id", "=", id).execute();
    },

    async deleteExpired(expiredBefore: Date): Promise<number> {
      const result = await db
        .deleteFrom("login_flows")
        .where("expires_at", "<", expiredBefore)
        .executeTakeFirst();

      return Number(result.numDeletedRows ?? 0);
    },
  };
}

export type LoginFlowsRepo = ReturnType<typeof createLoginFlowsRepo>;
