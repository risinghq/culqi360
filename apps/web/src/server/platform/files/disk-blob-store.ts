import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

import type { BlobOpener, BlobStore } from "./blob-store";

// Each namespace is a directory under `root`.
export function diskBlobs(root: string): BlobOpener {
  return (name) => createDiskBlobStore(join(root, name));
}

function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function resolveContainedPath(rootDir: string, key: string): string {
  if (key.trim().length === 0 || key.includes("\\")) {
    throw new Error("invalid_blob_key");
  }

  const root = resolve(rootDir);
  const target = resolve(root, key);
  const rel = relative(root, target);
  if (rel === "" || rel.startsWith("..") || rel.includes(`..${sep}`)) {
    throw new Error("invalid_blob_key");
  }

  return target;
}

export function createDiskBlobStore(rootDir: string): BlobStore {
  return {
    async putFromWebStream({ key, stream, onChunk }) {
      const finalPath = resolveContainedPath(rootDir, key);
      await mkdir(dirname(finalPath), { recursive: true });

      const tempPath = `${finalPath}.upload-${randomUUID()}`;
      const writer = createWriteStream(tempPath, { flags: "wx" });
      const hasher = createHash("sha256");
      let sizeBytes = 0;
      let failed = false;

      async function writeChunk(chunk: Uint8Array): Promise<void> {
        if (failed) {
          throw new Error("write_session_closed");
        }
        await onChunk?.(chunk);
        sizeBytes += chunk.byteLength;
        hasher.update(chunk);
        if (!writer.write(chunk)) {
          await once(writer, "drain");
        }
      }

      writer.on("error", () => {
        failed = true;
      });

      try {
        await stream.pipeTo(
          new WritableStream({
            write: (chunk) => writeChunk(chunk),
          }),
        );
        writer.end();
        await once(writer, "finish");
        await rename(tempPath, finalPath);
      } catch (error) {
        writer.destroy();
        await rm(tempPath, { force: true });
        throw error;
      }

      return { sha256: hasher.digest("hex"), sizeBytes };
    },

    async putBytes(key, content) {
      const finalPath = resolveContainedPath(rootDir, key);
      await mkdir(dirname(finalPath), { recursive: true });
      await writeFile(finalPath, content);
      return { sha256: hashBytes(content), sizeBytes: content.byteLength };
    },

    async getBytes(key) {
      return readFile(resolveContainedPath(rootDir, key));
    },

    async delete(key) {
      await rm(resolveContainedPath(rootDir, key), { force: true });
    },
  };
}
