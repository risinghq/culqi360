import type { Role } from "~/domain/auth/access/rbac";
import { external, type DomainError } from "~/domain/errors";
import { ActivityId, type BranchId, type UserId } from "~/domain/ids";
import { dateFromEpochMilliseconds } from "~/domain/time/clock";
import type { ActivitiesRepo } from "~/server/activities/infrastructure/activities-repo";
import type { AppUow } from "~/server/platform/database/uow";
import type { OperationContext } from "~/server/platform/operation/context";
import { Err, Ok, isErr, type Result } from "~/shared/result";

import {
  type ExtensionRuntimeEventEnvelope,
  type TeamExecutiveStatusView,
} from "../contracts";
import { authenticateInstallationSession } from "./authenticate";
import {
  mapLifecycleStatus,
  upsertSyncHealth,
  withDerivedProjectionStatuses,
} from "./presence";
import type { ExtensionRepos } from "./shared";

interface EventsWriteContext extends OperationContext {
  repos: ExtensionRepos;
  uow: AppUow<ExtensionRepos>;
}
interface EventsReadContext extends OperationContext {
  repos: ExtensionRepos;
}

// The extension's call session id is the call activity id the claim minted.
function eventCallId(sessionId: string | null): ActivityId | null {
  if (sessionId === null) {
    return null;
  }
  const parsed = ActivityId.parse(sessionId);
  return isErr(parsed) ? null : parsed.value;
}

// Copies what the extension learned about a call onto its activity. The
// result is recorded in the app, not by the extension.
async function recordCallFacts(
  activities: ActivitiesRepo,
  userId: UserId,
  event: ExtensionRuntimeEventEnvelope,
): Promise<void> {
  if (event.type === "call.lifecycle" && event.payload.event === "ended") {
    const activityId = eventCallId(event.payload.sessionId);
    if (activityId !== null) {
      await activities.endOwn({
        activityId,
        userId,
        endedAt: dateFromEpochMilliseconds(event.payload.at),
      });
    }
    return;
  }

  if (
    event.type === "call.metric" &&
    event.payload.event === "duration" &&
    typeof event.payload.durationSeconds === "number" &&
    Number.isSafeInteger(event.payload.durationSeconds) &&
    event.payload.durationSeconds >= 0
  ) {
    const activityId = eventCallId(event.payload.sessionId);
    if (activityId !== null) {
      await activities.recordDuration({
        activityId,
        userId,
        durationSeconds: event.payload.durationSeconds,
      });
    }
  }
}

export async function ingestRuntimeEvent(
  context: EventsWriteContext,
  input: {
    sessionToken: string;
    event: ExtensionRuntimeEventEnvelope;
  },
): Promise<Result<void, DomainError>> {
  const { uow } = context;

  try {
    const authenticated = await authenticateInstallationSession(
      context.repos,
      input.sessionToken,
      context.operationAt,
    );
    if (isErr(authenticated)) {
      return authenticated;
    }
    const session = authenticated.value;

    const payloadText = JSON.stringify(input.event.payload);
    const eventSessionId =
      "sessionId" in input.event.payload &&
      typeof input.event.payload.sessionId === "string"
        ? input.event.payload.sessionId
        : null;
    const eventCreatedAt = dateFromEpochMilliseconds(input.event.createdAt);

    return await uow.run(async (txRepos) => {
      const inserted =
        await txRepos.extensionRuntime.insertRuntimeEventIfAbsent({
          id: input.event.id,
          sequence: input.event.sequence,
          user_id: session.user_id,
          branch_id: session.branch_id,
          call_session_id: eventSessionId,
          type: input.event.type,
          payload_json: payloadText,
          created_at: eventCreatedAt,
          received_at: context.operationAt,
        });

      await upsertSyncHealth(txRepos.extensionRuntime, {
        userId: session.user_id,
        branchId: session.branch_id,
        syncHealth: "ok",
        updatedAt: context.operationAt,
      });

      if (!inserted) {
        return Ok(undefined);
      }

      await recordCallFacts(txRepos.activities, session.user_id, input.event);

      if (input.event.type === "executive.presence") {
        await txRepos.extensionRuntime.upsertExecutivePresence({
          user_id: session.user_id,
          branch_id: session.branch_id,
          call_session_id: input.event.payload.callSessionId,
          presence_status: input.event.payload.presenceStatus,
          presence_updated_at: dateFromEpochMilliseconds(
            input.event.payload.updatedAt,
          ),
          source_event_id: input.event.id,
          source_event_sequence: input.event.sequence,
        });
        return Ok(undefined);
      }

      if (input.event.type === "call.lifecycle") {
        await txRepos.extensionRuntime.upsertExecutivePresence({
          user_id: session.user_id,
          branch_id: session.branch_id,
          call_session_id: eventSessionId,
          presence_status: mapLifecycleStatus(input.event),
          presence_updated_at: dateFromEpochMilliseconds(
            input.event.payload.at,
          ),
          source_event_id: input.event.id,
          source_event_sequence: input.event.sequence,
        });
      }

      return Ok(undefined);
    });
  } catch (error: unknown) {
    return Err(
      external(
        error instanceof Error
          ? error.message
          : "Unexpected extension event ingest failure",
        { code: "unexpected" },
      ),
    );
  }
}

export async function listTeamExecutiveStatuses(
  context: EventsReadContext,
  input: {
    role: Role;
    userId: UserId;
    branchId: BranchId;
  },
): Promise<Result<TeamExecutiveStatusView[], DomainError>> {
  const { repos } = context;

  try {
    if (input.role === "supervisor") {
      return Ok(
        withDerivedProjectionStatuses(
          await repos.extensionRuntime.listTeamStatusesBySupervisor(
            input.userId,
          ),
          context.operationAt,
        ),
      );
    }

    return Ok(
      withDerivedProjectionStatuses(
        await repos.extensionRuntime.listBranchStatuses(input.branchId),
        context.operationAt,
      ),
    );
  } catch (error: unknown) {
    return Err(
      external(
        error instanceof Error
          ? error.message
          : "Unexpected extension status read failure",
        { code: "unexpected" },
      ),
    );
  }
}
