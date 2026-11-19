import { createAssetsRepo } from "~/server/files/repo/assets";
import { createRateRevisionFilesRepo } from "~/server/files/repo/rate-revision";
import { createSalesRepo } from "~/server/files/repo/sales";
import { createTokensRepo } from "~/server/files/repo/tokens";
import type { FileRepos } from "~/server/files/service/contracts";
import { executeDownload } from "~/server/files/service/execute-download";
import type { BlobStore } from "~/server/platform/files/blob-store";
import type { WorkspaceInfrastructure } from "~/server/platform/infrastructure";
import type { OperationContext } from "~/server/platform/operation/context";

export type FilesRuntime = {
  repo: FileRepos;
  storage: BlobStore;
  download: (
    token: Parameters<typeof executeDownload>[0],
    operation: OperationContext,
  ) => ReturnType<typeof executeDownload>;
};

export function createFilesRuntime(
  workspace: Pick<WorkspaceInfrastructure, "db" | "blobs">,
): FilesRuntime {
  const repo: FileRepos = {
    assets: createAssetsRepo(workspace.db),
    tokens: createTokensRepo(workspace.db),
    sales: createSalesRepo(workspace.db),
    rateRevision: createRateRevisionFilesRepo(workspace.db),
  };

  const storage = workspace.blobs;

  return {
    repo,
    storage,
    download: (token, operation) =>
      executeDownload(token, { repo, storage }, operation),
  };
}
