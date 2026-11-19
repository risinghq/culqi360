import type { BlobOpener, BlobStore } from "./blob-store";

// The part of an R2 bucket binding the store uses. Declared here so the server
// code type-checks without the Workers runtime types.
export interface R2BucketLike {
  put(key: string, value: Uint8Array): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  delete(key: string): Promise<void>;
}

// Each namespace is a key prefix in one bucket.
export function r2Blobs(bucket: R2BucketLike): BlobOpener {
  return (name) => createR2BlobStore(bucket, name);
}

// The same keys the disk store accepts: a relative path with no empty, `.` or
// `..` segment, so a key cannot reach another namespace's prefix.
function objectKey(prefix: string, key: string): string {
  const segments = key.split("/");
  if (
    key.includes("\\") ||
    segments.some((s) => s === "" || s === "." || s === "..")
  ) {
    throw new Error("invalid_blob_key");
  }
  return `${prefix}/${key}`;
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

function concat(chunks: Uint8Array[], size: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function createR2BlobStore(
  bucket: R2BucketLike,
  prefix: string,
): BlobStore {
  async function write(key: string, content: Uint8Array<ArrayBuffer>) {
    await bucket.put(objectKey(prefix, key), content);
    return { sha256: await sha256Hex(content), sizeBytes: content.byteLength };
  }

  return {
    // Web Crypto refuses a view over a SharedArrayBuffer, which the interface
    // allows, so the bytes are copied into a plain buffer first.
    putBytes: (key, content) => write(key, new Uint8Array(content)),

    // R2 needs a stream's length before it starts, so the upload is buffered.
    // Every caller's `onChunk` caps the size, at 20 MiB for an upload, well
    // inside a Worker's memory. Nothing is written until the stream ends, so a
    // refused stream leaves no object behind.
    async putFromWebStream({ key, stream, onChunk }) {
      objectKey(prefix, key);
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of stream) {
        await onChunk?.(chunk);
        chunks.push(chunk);
        size += chunk.byteLength;
      }
      return write(key, concat(chunks, size));
    },

    async getBytes(key) {
      const object = await bucket.get(objectKey(prefix, key));
      if (!object) {
        throw new Error("blob_not_found");
      }
      return new Uint8Array(await object.arrayBuffer());
    },

    async delete(key) {
      await bucket.delete(objectKey(prefix, key));
    },
  };
}
