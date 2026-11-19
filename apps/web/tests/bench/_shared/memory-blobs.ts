import { createHash } from "node:crypto";

import type { BlobOpener, BlobStore } from "~/server/platform/files/blob-store";

function stored(content: Uint8Array) {
  return {
    sha256: createHash("sha256").update(content).digest("hex"),
    sizeBytes: content.byteLength,
  };
}

function memoryBlobStore(): BlobStore {
  const blobs = new Map<string, Uint8Array>();
  return {
    async putBytes(key, content) {
      blobs.set(key, content);
      return stored(content);
    },
    async putFromWebStream({ key, stream, onChunk }) {
      const chunks: Uint8Array[] = [];
      for await (const chunk of stream) {
        await onChunk?.(chunk);
        chunks.push(chunk);
      }
      const content = Buffer.concat(chunks);
      blobs.set(key, content);
      return stored(content);
    },
    async getBytes(key) {
      const content = blobs.get(key);
      if (!content) throw new Error(`no blob at ${key}`);
      return content;
    },
    async delete(key) {
      blobs.delete(key);
    },
  };
}

// One map per namespace, kept for the opener's lifetime, so a second open of
// the same name sees the first one's writes.
export function memoryBlobs(): BlobOpener {
  const namespaces = new Map<string, BlobStore>();
  return (name) => {
    let store = namespaces.get(name);
    if (!store) {
      store = memoryBlobStore();
      namespaces.set(name, store);
    }
    return store;
  };
}
