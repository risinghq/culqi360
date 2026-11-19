import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  r2Blobs,
  type R2BucketLike,
} from "~/server/platform/files/r2-blob-store";

function createBucket() {
  const objects = new Map<string, Uint8Array>();
  const bucket: R2BucketLike = {
    async put(key, value) {
      objects.set(key, value.slice());
    },
    async get(key) {
      const bytes = objects.get(key);
      return bytes ? { arrayBuffer: async () => bytes.slice().buffer } : null;
    },
    async delete(key) {
      objects.delete(key);
    },
  };
  return { bucket, objects };
}

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

describe("r2 blob store", () => {
  it("stores each namespace under its own prefix", async () => {
    const { bucket, objects } = createBucket();
    const open = r2Blobs(bucket);

    await open("avatars").putBytes("a/1.png", new Uint8Array([1]));
    await open("workspaces/w1/files").putBytes("a/1.png", new Uint8Array([2]));

    expect([...objects.keys()].toSorted()).toEqual([
      "avatars/a/1.png",
      "workspaces/w1/files/a/1.png",
    ]);
    expect(await open("avatars").getBytes("a/1.png")).toEqual(
      new Uint8Array([1]),
    );
  });

  it("hashes a streamed upload as the whole content", async () => {
    const { bucket } = createBucket();
    const store = r2Blobs(bucket)("files");
    const seen: number[] = [];

    const stored = await store.putFromWebStream({
      key: "upload.csv",
      stream: streamOf("a,b\n", "1,2\n"),
      onChunk: (chunk) => {
        seen.push(chunk.byteLength);
      },
    });

    expect(seen).toEqual([4, 4]);
    expect(stored).toEqual({
      sha256: createHash("sha256").update("a,b\n1,2\n").digest("hex"),
      sizeBytes: 8,
    });
    expect(new TextDecoder().decode(await store.getBytes("upload.csv"))).toBe(
      "a,b\n1,2\n",
    );
  });

  it("writes nothing when a chunk is refused", async () => {
    const { bucket, objects } = createBucket();
    const store = r2Blobs(bucket)("files");

    await expect(
      store.putFromWebStream({
        key: "upload.csv",
        stream: streamOf("ok", "too much"),
        onChunk: (chunk) => {
          if (chunk.byteLength > 2) {
            throw new Error("too_large");
          }
        },
      }),
    ).rejects.toThrow("too_large");
    expect(objects.size).toBe(0);
  });

  it.each(["", "../avatars/x", "a//b", "./a", "a\\b", "/a"])(
    "refuses the key %j",
    async (key) => {
      const store = r2Blobs(createBucket().bucket)("files");

      await expect(store.putBytes(key, new Uint8Array())).rejects.toThrow(
        "invalid_blob_key",
      );
    },
  );

  it("reports a missing object", async () => {
    const store = r2Blobs(createBucket().bucket)("files");

    await expect(store.getBytes("absent")).rejects.toThrow("blob_not_found");
  });
});
