import { join } from "node:path";

import {
  cleanupTestDb,
  createIsolatedTestDb,
  resetTestDb,
  TEST_FIXTURES,
  type TestDbContext,
} from "@tests/support/runtime/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { UserId } from "~/domain/ids";
import { createDiskBlobStore } from "~/server/platform/files/disk-blob-store";
import {
  createAvatarService,
  readAvatarFile,
  type AvatarUpload,
  type AvatarUsersRepository,
} from "~/server/users/avatar-service";
import { createAccountsRepo } from "~/server/users/repos-accounts";

const TARGET_ID = TEST_FIXTURES.users.execOne.id;

function pngFile(bytes: number[] = [1, 2, 3]): AvatarUpload {
  return { bytes: new Uint8Array(bytes), type: "image/png" };
}

describe("avatar service", () => {
  let ctx: TestDbContext;

  beforeAll(async () => {
    ctx = await createIsolatedTestDb("avatar-service");
  });

  afterAll(async () => {
    await cleanupTestDb(ctx);
  });

  beforeEach(async () => {
    await resetTestDb(ctx);
  });

  function makeService(usersOverride?: Partial<AvatarUsersRepository>) {
    const users = {
      ...createAccountsRepo(ctx.platform),
      ...usersOverride,
    };
    const blobStore = createDiskBlobStore(join(ctx.storageRoot, "avatars"));

    return {
      service: createAvatarService({ users }, blobStore),
      blobStore,
    };
  }

  async function seedAvatar(values: {
    storageKey: string | null;
    mimeType: string | null;
    version: number;
  }) {
    await ctx.platform
      .updateTable("accounts")
      .set({
        avatar_storage_key: values.storageKey,
        avatar_mime_type: values.mimeType,
        avatar_updated_at: values.storageKey ? new Date() : null,
        avatar_version: values.version,
      })
      .where("id", "=", TARGET_ID)
      .execute();
  }

  it("uploads a new avatar and deletes the previous blob from disk", async () => {
    const { service, blobStore } = makeService();
    const oldKey = `${TARGET_ID}/old.png`;

    await blobStore.putBytes(oldKey, new Uint8Array([9, 9, 9]));
    await seedAvatar({
      storageKey: oldKey,
      mimeType: "image/png",
      version: 2,
    });

    const result = await service.upload(TARGET_ID, pngFile(), new Date());

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected success");
    }

    expect(result.value.avatarVersion).toBe(3);
    await expect(blobStore.getBytes(oldKey)).rejects.toThrow(/ENOENT/);

    const row = await ctx.platform
      .selectFrom("accounts")
      .select(["avatar_storage_key", "avatar_version"])
      .where("id", "=", TARGET_ID)
      .executeTakeFirstOrThrow();

    expect(row.avatar_version).toBe(3);
    expect(row.avatar_storage_key).not.toBe(oldKey);

    if (!row.avatar_storage_key) {
      throw new Error("expected a storage key");
    }

    const newBytes = await blobStore.getBytes(row.avatar_storage_key);

    expect(Array.from(newBytes)).toEqual([1, 2, 3]);
  });

  // A key outside the blob root forces the deletion to fail.
  it("keeps the upload successful when deleting the previous blob fails", async () => {
    const { service } = makeService();

    await seedAvatar({
      storageKey: "../outside-root.png",
      mimeType: "image/png",
      version: 2,
    });

    const result = await service.upload(TARGET_ID, pngFile(), new Date());

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected success");
    }

    expect(result.value.avatarVersion).toBe(3);
  });

  it("keeps remove successful when deleting the previous blob fails", async () => {
    const { service } = makeService();

    await seedAvatar({
      storageKey: "../outside-root.png",
      mimeType: "image/png",
      version: 9,
    });

    const result = await service.remove(TARGET_ID, new Date());

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected success");
    }

    expect(result.value.avatarVersion).toBe(10);

    const row = await ctx.platform
      .selectFrom("accounts")
      .select(["avatar_storage_key"])
      .where("id", "=", TARGET_ID)
      .executeTakeFirstOrThrow();

    expect(row.avatar_storage_key).toBeNull();
  });

  // Fail after putBytes to verify the newly written blob is rolled back.
  it("rolls back the newly written blob when the db write fails", async () => {
    const users = {
      ...createAccountsRepo(ctx.platform),
      updateAvatar: () => Promise.reject(new Error("db connection lost")),
    };

    const realBlobStore = createDiskBlobStore(join(ctx.storageRoot, "avatars"));
    let writtenKey: string | undefined;

    const blobStore = {
      ...realBlobStore,
      async putBytes(key: string, content: Uint8Array) {
        writtenKey = key;
        return realBlobStore.putBytes(key, content);
      },
    };

    const service = createAvatarService({ users }, blobStore);
    const result = await service.upload(TARGET_ID, pngFile(), new Date());

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected failure");
    }

    expect(result.error.code).toBe("repository_unavailable");

    const row = await ctx.platform
      .selectFrom("accounts")
      .select(["avatar_storage_key"])
      .where("id", "=", TARGET_ID)
      .executeTakeFirstOrThrow();

    expect(row.avatar_storage_key).toBeNull();

    if (!writtenKey) {
      throw new Error("expected putBytes to be called");
    }

    await expect(realBlobStore.getBytes(writtenKey)).rejects.toThrow(/ENOENT/);
  });

  it("returns user_not_found when the user record is missing", async () => {
    const { service } = makeService();
    const missingId = UserId.trust(crypto.randomUUID());

    const [uploadResult, removeResult] = await Promise.all([
      service.upload(missingId, pngFile(), new Date()),
      service.remove(missingId, new Date()),
    ]);

    expect(uploadResult.ok).toBe(false);
    if (uploadResult.ok) {
      throw new Error("expected failure");
    }

    expect(uploadResult.error.code).toBe("user_not_found");

    expect(removeResult.ok).toBe(false);
    if (removeResult.ok) {
      throw new Error("expected failure");
    }

    expect(removeResult.error.code).toBe("user_not_found");
  });

  it("rejects unsupported mime type", async () => {
    const { service } = makeService();
    const upload = { bytes: new Uint8Array([1]), type: "image/webp" };

    const result = await service.upload(TARGET_ID, upload, new Date());

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected failure");
    }

    expect(result.error.code).toBe("unsupported_mime");
  });

  it("rejects an empty file", async () => {
    const { service } = makeService();
    const result = await service.upload(TARGET_ID, pngFile([]), new Date());

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected failure");
    }

    expect(result.error.code).toBe("invalid_file");
  });

  it("rejects files larger than 10MB", async () => {
    const { service } = makeService();
    const upload = {
      bytes: new Uint8Array(10 * 1024 * 1024 + 1),
      type: "image/png",
    };

    const result = await service.upload(TARGET_ID, upload, new Date());

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected failure");
    }

    expect(result.error.code).toBe("too_large");
  });

  it("reads a form file into bytes, refusing a bad one before buffering it", async () => {
    const png = new File([new Uint8Array([1, 2, 3])], "avatar.png", {
      type: "image/png",
    });
    const webp = new File([new Uint8Array([1])], "avatar.webp", {
      type: "image/webp",
    });

    expect(await readAvatarFile(png)).toEqual({
      ok: true,
      value: { bytes: new Uint8Array([1, 2, 3]), type: "image/png" },
    });
    expect(await readAvatarFile(webp)).toEqual({
      ok: false,
      error: { code: "unsupported_mime" },
    });
  });

  it("returns avatar_not_found when no avatar exists for read", async () => {
    const { service } = makeService();
    const result = await service.get(TARGET_ID);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected failure");
    }

    expect(result.error.code).toBe("avatar_not_found");
  });

  it("returns storage_unavailable when the avatar blob is missing on disk", async () => {
    const { service } = makeService();

    await seedAvatar({
      storageKey: `${TARGET_ID}/never-written.png`,
      mimeType: "image/png",
      version: 6,
    });

    const result = await service.get(TARGET_ID);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected failure");
    }

    expect(result.error.code).toBe("storage_unavailable");
  });
});
