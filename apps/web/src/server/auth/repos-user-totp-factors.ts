import type { Kysely, Selectable } from "kysely";
import { v7 as uuidv7 } from "uuid";

import type { UserId } from "~/domain/ids";
import type { PlatformDatabase } from "~/server/platform/database/types";

type UserTotpFactorRow = Selectable<PlatformDatabase["user_totp_factors"]>;

export function createUserTotpFactorsRepo(db: Kysely<PlatformDatabase>) {
  return {
    findByAccountId(accountId: UserId): Promise<UserTotpFactorRow | undefined> {
      return db
        .selectFrom("user_totp_factors")
        .selectAll()
        .where("account_id", "=", accountId)
        .executeTakeFirst();
    },

    async createOrRotate(
      accountId: UserId,
      secretEncrypted: string,
      changedAt: Date,
    ): Promise<UserTotpFactorRow> {
      await db
        .insertInto("user_totp_factors")
        .values({
          id: uuidv7(),
          account_id: accountId,
          secret_encrypted: secretEncrypted,
          is_enabled: false,
          created_at: changedAt,
          updated_at: changedAt,
          enabled_at: null,
        })
        .onConflict((oc) =>
          oc.column("account_id").doUpdateSet({
            secret_encrypted: secretEncrypted,
            is_enabled: false,
            updated_at: changedAt,
            enabled_at: null,
          }),
        )
        .execute();

      return db
        .selectFrom("user_totp_factors")
        .selectAll()
        .where("account_id", "=", accountId)
        .executeTakeFirstOrThrow();
    },

    async enableIfSecretMatches(
      accountId: UserId,
      secretEncrypted: string,
      enabledAt: Date,
    ): Promise<boolean> {
      const result = await db
        .updateTable("user_totp_factors")
        .set({
          is_enabled: true,
          enabled_at: enabledAt,
          updated_at: enabledAt,
        })
        .where("account_id", "=", accountId)
        .where("secret_encrypted", "=", secretEncrypted)
        .executeTakeFirst();

      return Number(result.numUpdatedRows ?? 0) > 0;
    },

    async disable(accountId: UserId, disabledAt: Date): Promise<void> {
      await db
        .updateTable("user_totp_factors")
        .set({
          is_enabled: false,
          enabled_at: null,
          updated_at: disabledAt,
        })
        .where("account_id", "=", accountId)
        .execute();
    },
  };
}

export type UserTotpFactorsRepo = ReturnType<typeof createUserTotpFactorsRepo>;
