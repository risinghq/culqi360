import type { Kysely } from "kysely";
import { v7 as uuidv7 } from "uuid";

import type { UserId } from "~/domain/ids";
import type { PlatformDatabase } from "~/server/platform/database/types";

export function createOAuthAccountsRepo(db: Kysely<PlatformDatabase>) {
  return {
    findByProvider(provider: string, providerUserId: string) {
      return db
        .selectFrom("user_oauth_accounts")
        .selectAll()
        .where("provider", "=", provider)
        .where("provider_user_id", "=", providerUserId)
        .executeTakeFirst();
    },

    create(values: {
      account_id: UserId;
      provider: string;
      provider_user_id: string;
      email: string;
      created_at: Date;
    }) {
      return db
        .insertInto("user_oauth_accounts")
        .values({ id: uuidv7(), ...values })
        .executeTakeFirst();
    },
  };
}

export type OAuthAccountsRepo = ReturnType<typeof createOAuthAccountsRepo>;
