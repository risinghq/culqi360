import { UserId } from "~/domain/ids";
import type { PlatformExecutor } from "~/server/platform/database/executor";

// Platform store. An account is the person's identity and credentials; each
// workspace keeps its own member row under the same id.
export function createAccountsRepo(db: PlatformExecutor) {
  return {
    findById(id: UserId) {
      return db
        .selectFrom("accounts")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst();
    },

    findByEmail(email: string) {
      return db
        .selectFrom("accounts")
        .selectAll()
        .where("email", "=", email)
        .executeTakeFirst();
    },

    findByUsername(username: string) {
      return db
        .selectFrom("accounts")
        .selectAll()
        .where("username", "=", username)
        .executeTakeFirst();
    },

    async isUsernameTaken(username: string): Promise<boolean> {
      const row = await db
        .selectFrom("accounts")
        .select("id")
        .where("username", "=", username)
        .executeTakeFirst();
      return row !== undefined;
    },

    // The caller mints the id first when a workspace row must carry it before
    // the account exists.
    async create(values: {
      id?: UserId;
      username: string;
      email: string;
      password_hash: string;
      names: string;
      first_surname: string;
      second_surname: string;
      is_operator?: boolean;
      created_at: Date;
    }): Promise<UserId> {
      const id = values.id ?? UserId.mint();
      await db
        .insertInto("accounts")
        .values({ ...values, id, password_change_required: false })
        .execute();
      return id;
    },

    async updatePassword(id: UserId, passwordHash: string): Promise<void> {
      await db
        .updateTable("accounts")
        .set({ password_hash: passwordHash })
        .where("id", "=", id)
        .execute();
    },

    async replaceInstallationPassword(
      id: UserId,
      passwordHash: string,
    ): Promise<void> {
      await db
        .updateTable("accounts")
        .set({ password_hash: passwordHash, password_change_required: false })
        .where("id", "=", id)
        .execute();
    },

    async updateNames(
      id: UserId,
      values: { names: string; first_surname: string; second_surname: string },
    ): Promise<void> {
      await db
        .updateTable("accounts")
        .set(values)
        .where("id", "=", id)
        .execute();
    },

    findAvatarMetaById(id: UserId) {
      return db
        .selectFrom("accounts")
        .select([
          "id",
          "avatar_storage_key",
          "avatar_mime_type",
          "avatar_updated_at",
          "avatar_version",
        ])
        .where("id", "=", id)
        .executeTakeFirst();
    },

    async updateAvatar(
      id: UserId,
      values: {
        storage_key: string;
        mime_type: string;
        updated_at: Date;
        version: number;
      },
    ): Promise<void> {
      await db
        .updateTable("accounts")
        .set({
          avatar_storage_key: values.storage_key,
          avatar_mime_type: values.mime_type,
          avatar_updated_at: values.updated_at,
          avatar_version: values.version,
        })
        .where("id", "=", id)
        .execute();
    },

    async clearAvatar(
      id: UserId,
      values: { updated_at: Date; version: number },
    ): Promise<void> {
      await db
        .updateTable("accounts")
        .set({
          avatar_storage_key: null,
          avatar_mime_type: null,
          avatar_updated_at: values.updated_at,
          avatar_version: values.version,
        })
        .where("id", "=", id)
        .execute();
    },

    async deleteById(id: UserId): Promise<void> {
      await db.deleteFrom("accounts").where("id", "=", id).execute();
    },
  };
}

export type AccountsRepo = ReturnType<typeof createAccountsRepo>;
