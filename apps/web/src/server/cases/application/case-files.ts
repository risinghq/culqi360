import type { DomainError } from "~/domain/errors";
import type { FileAssetId } from "~/domain/ids";
import type {
  DownloadTokenDeps,
  FileOperationContext,
  StoreFileDeps,
} from "~/server/files/service/contracts";
import { issueDownloadToken } from "~/server/files/service/issue-download-token";
import { storeUploadedFile } from "~/server/files/service/store-uploaded-file";
import { Ok, type Result } from "~/shared/result";

import { findCaseFile, type CaseReads } from "./read-cases";

export type CaseFileUpload = {
  name: string;
  sizeBytes: number;
  stream: ReadableStream<Uint8Array>;
};

// An upload belongs to no case until a stage write puts its id in a file
// field; the write accepts only the writer's own uploads.
export async function uploadCaseFile(
  deps: StoreFileDeps,
  ctx: FileOperationContext,
  file: CaseFileUpload,
): Promise<Result<{ id: FileAssetId; name: string }, DomainError>> {
  const stored = await storeUploadedFile(
    ctx,
    { purpose: "case_file", ...file },
    deps,
  );
  return stored.ok
    ? Ok({ id: stored.value.id, name: stored.value.safeDisplayFilename })
    : stored;
}

export async function issueCaseFileToken(
  deps: { reads: CaseReads; files: DownloadTokenDeps },
  ctx: FileOperationContext,
  input: Parameters<typeof findCaseFile>[1],
): Promise<Result<{ token: string }, DomainError>> {
  const file = await findCaseFile(deps.reads, input);
  return file.ok ? issueDownloadToken(ctx, file.value, deps.files) : file;
}
