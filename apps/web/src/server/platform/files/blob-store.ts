import type { WorkspaceId } from "~/domain/ids";

// Bytes under a key, inside one named namespace. The key layout is the
// caller's; a key is a relative path with no `..` segment.
export interface BlobStore {
  putBytes(
    key: string,
    content: Uint8Array,
  ): Promise<{ sha256: string; sizeBytes: number }>;
  putFromWebStream(input: {
    key: string;
    stream: ReadableStream<Uint8Array>;
    onChunk?: (chunk: Uint8Array) => void | Promise<void>;
  }): Promise<{ sha256: string; sizeBytes: number }>;
  getBytes(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
}

// Names one namespace: "avatars", or a workspace's own files, so removing a
// workspace removes one prefix.
export type BlobOpener = (name: string) => BlobStore;

export const AVATAR_BLOBS = "avatars";

export const workspaceBlobsName = (workspaceId: WorkspaceId) =>
  `workspaces/${workspaceId}/files`;
