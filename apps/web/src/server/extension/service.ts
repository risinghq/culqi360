import { addMilliseconds } from "~/domain/time/clock";
import type { OperationContext } from "~/server/platform/operation/context";
import type { Duty } from "~/server/platform/schedule/schedule";
import { createLogger } from "~/shared/observability/runtime-logger";

import {
  ingestRuntimeEvent,
  listTeamExecutiveStatuses,
} from "./service/events";
import {
  claimInstallationSession,
  createHandoffToken,
} from "./service/handoff";
import {
  closeRecording,
  createRecording,
  putSegment,
  RECORDING_IDLE_TIMEOUT_MS,
  sweepIdleRecordings,
} from "./service/recordings";
import { refreshInstallationSession } from "./service/session";
import type { ExtensionRepos, ExtensionServiceDeps } from "./service/shared";

type CreateHandoffTokenInput = Parameters<typeof createHandoffToken>[1];
type ClaimInstallationSessionInput = Parameters<
  typeof claimInstallationSession
>[1];
type RefreshInstallationSessionInput = Parameters<
  typeof refreshInstallationSession
>[1];
type IngestRuntimeEventInput = Parameters<typeof ingestRuntimeEvent>[1];
type CreateRecordingInput = Parameters<typeof createRecording>[1];
type PutSegmentInput = Parameters<typeof putSegment>[1];
type CloseRecordingInput = Parameters<typeof closeRecording>[1];
type ListTeamExecutiveStatusesInput = Parameters<
  typeof listTeamExecutiveStatuses
>[1];

const logger = createLogger("extension-recording-sweep");

export function createExtensionService(
  repos: ExtensionRepos,
  deps: ExtensionServiceDeps,
) {
  const { uow, workspaceId } = deps;

  return {
    createHandoffToken: (
      input: CreateHandoffTokenInput,
      operation: OperationContext,
    ) =>
      createHandoffToken(
        {
          workspaceId,
          repos,
          uow,
          operationAt: operation.operationAt,
        },
        input,
      ),

    claimInstallationSession: (
      input: ClaimInstallationSessionInput,
      operation: OperationContext,
    ) =>
      claimInstallationSession(
        {
          workspaceId,
          repos,
          uow,
          operationAt: operation.operationAt,
        },
        input,
      ),

    refreshInstallationSession: (
      input: RefreshInstallationSessionInput,
      operation: OperationContext,
    ) =>
      refreshInstallationSession(
        {
          workspaceId,
          repos,
          operationAt: operation.operationAt,
        },
        input,
      ),

    ingestRuntimeEvent: (
      input: IngestRuntimeEventInput,
      operation: OperationContext,
    ) =>
      ingestRuntimeEvent(
        {
          repos,
          uow,
          operationAt: operation.operationAt,
        },
        input,
      ),

    createRecording: (
      input: CreateRecordingInput,
      operation: OperationContext,
    ) => createRecording({ repos, operationAt: operation.operationAt }, input),

    putSegment: (input: PutSegmentInput, operation: OperationContext) =>
      putSegment(
        {
          repos,
          uow,
          storage: deps.storage,
          operationAt: operation.operationAt,
        },
        input,
      ),

    closeRecording: (input: CloseRecordingInput, operation: OperationContext) =>
      closeRecording({ repos, uow, operationAt: operation.operationAt }, input),

    sweepIdleRecordings: (operation: OperationContext) =>
      sweepIdleRecordings({ uow, operationAt: operation.operationAt }),

    idleRecordingsDuty: {
      name: "extension-recording-sweep",
      async nextAt() {
        const idleSince =
          await repos.extensionRecordings.oldestIdleActivityAt();
        return (
          idleSince && addMilliseconds(idleSince, RECORDING_IDLE_TIMEOUT_MS)
        );
      },
      async run(operation) {
        const swept = await sweepIdleRecordings({
          uow,
          operationAt: operation.operationAt,
        });
        if (swept.interruptedRecordings > 0 || swept.endedCalls > 0) {
          logger.info("extension_recordings_swept", { ...swept });
        }
      },
    } satisfies Duty,

    listTeamExecutiveStatuses: (
      input: ListTeamExecutiveStatusesInput,
      operation: OperationContext,
    ) =>
      listTeamExecutiveStatuses(
        {
          repos,
          operationAt: operation.operationAt,
        },
        input,
      ),
  };
}
