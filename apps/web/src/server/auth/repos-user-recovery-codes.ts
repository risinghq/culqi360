import { RecoveryCodeId, RecoveryCodeSetId, type UserId } from "~/domain/ids";
import { insertBatches } from "~/server/platform/database/batches";
import type { PlatformExecutor } from "~/server/platform/database/executor";
import type { RecoveryCodeSetSource } from "~/server/platform/database/types";

type ActiveRecoveryCodeSet = {
  createdAt: Date;
  acknowledgedAt: Date | null;
  total: number;
  unused: number;
};

async function insertSet(
  executor: PlatformExecutor,
  accountId: UserId,
  source: RecoveryCodeSetSource,
  codeHashes: string[],
  createdAt: Date,
): Promise<void> {
  const setId = RecoveryCodeSetId.mint();
  await executor
    .insertInto("recovery_code_set")
    .values({
      id: setId,
      account_id: accountId,
      source,
      created_at: createdAt,
      acknowledged_at: null,
      revoked_at: null,
    })
    .execute();

  for (const batch of insertBatches(
    codeHashes.map((code_hash) => ({
      id: RecoveryCodeId.mint(),
      set_id: setId,
      code_hash,
      used_at: null,
    })),
  )) {
    // eslint-disable-next-line no-await-in-loop
    await executor.insertInto("recovery_code").values(batch).execute();
  }
}

// An active set serves both TOTP and passkey. This repository owns atomic
// single-use consumption rather than leaving a read-then-write race to callers.
export function createUserRecoveryCodesRepo(db: PlatformExecutor) {
  function activeSetIds(accountId: UserId) {
    return db
      .selectFrom("recovery_code_set")
      .select("id")
      .where("account_id", "=", accountId)
      .where("revoked_at", "is", null);
  }

  return {
    // Call only after checking for an active set; the partial unique index
    // rejects a duplicate.
    issueSet(
      accountId: UserId,
      source: RecoveryCodeSetSource,
      codeHashes: string[],
      createdAt: Date,
    ): Promise<void> {
      return insertSet(db, accountId, source, codeHashes, createdAt);
    },

    async replaceSet(
      accountId: UserId,
      codeHashes: string[],
      replacedAt: Date,
    ): Promise<void> {
      await db
        .updateTable("recovery_code_set")
        .set({ revoked_at: replacedAt })
        .where("account_id", "=", accountId)
        .where("revoked_at", "is", null)
        .execute();
      await insertSet(db, accountId, "regenerate", codeHashes, replacedAt);
    },

    async getActiveSet(
      accountId: UserId,
    ): Promise<ActiveRecoveryCodeSet | null> {
      const set = await db
        .selectFrom("recovery_code_set")
        .select(["id", "created_at", "acknowledged_at"])
        .where("account_id", "=", accountId)
        .where("revoked_at", "is", null)
        .executeTakeFirst();

      if (!set) {
        return null;
      }

      const codes = await db
        .selectFrom("recovery_code")
        .select("used_at")
        .where("set_id", "=", set.id)
        .execute();

      return {
        createdAt: set.created_at,
        acknowledgedAt: set.acknowledged_at,
        total: codes.length,
        unused: codes.filter((code) => code.used_at === null).length,
      };
    },

    // Consumes one unused code matching `codeHash` in the account's active
    // set. The affected-row count is the verdict, so a code redeems once and
    // a revoked set never redeems.
    async consumeActiveCode(
      accountId: UserId,
      codeHash: string,
      consumedAt: Date,
    ): Promise<boolean> {
      const result = await db
        .updateTable("recovery_code")
        .set({ used_at: consumedAt })
        .where("code_hash", "=", codeHash)
        .where("used_at", "is", null)
        .where("set_id", "in", activeSetIds(accountId))
        .executeTakeFirst();

      return Number(result.numUpdatedRows ?? 0) > 0;
    },

    async acknowledgeActiveSet(
      accountId: UserId,
      acknowledgedAt: Date,
    ): Promise<boolean> {
      const result = await db
        .updateTable("recovery_code_set")
        .set({ acknowledged_at: acknowledgedAt })
        .where("account_id", "=", accountId)
        .where("revoked_at", "is", null)
        .where("acknowledged_at", "is", null)
        .executeTakeFirst();
      return Number(result.numUpdatedRows ?? 0) > 0;
    },

    async deleteAllByAccount(accountId: UserId): Promise<void> {
      await db
        .deleteFrom("recovery_code_set")
        .where("account_id", "=", accountId)
        .execute();
    },
  };
}

export type UserRecoveryCodesRepo = ReturnType<
  typeof createUserRecoveryCodesRepo
>;
