import { type DomainError } from "~/domain/errors";
import {
  createHistoryEvent,
  type LeadHistoryEventDraft,
} from "~/server/workflow/lead/domain/history";
import {
  authorizeLeadAction,
  type LeadPolicyActor as Actor,
} from "~/server/workflow/lead/domain/policy";
import type { LeadState } from "~/server/workflow/lead/domain/state";
import { Ok, type Result } from "~/shared/result";

export function recordNote(
  state: LeadState,
  input: { actor: Actor; body: string; occurredAt: Date },
): Result<LeadHistoryEventDraft[], DomainError> {
  const authz = authorizeLeadAction("add-note", input.actor, state);
  if (!authz.ok) {
    return authz;
  }

  return Ok([
    createHistoryEvent({
      leadId: state.id,
      eventType: "note_added",
      actorUserId: input.actor.userId,
      payload: { body: input.body },
      occurredAt: input.occurredAt,
    }),
  ]);
}
