import type { WorkflowInquiryId } from "~/domain/ids";
import type { WorkflowActor } from "~/server/workflow/actor";
import { answerInquiry } from "~/server/workflow/inquiry/answer";
import type { InquiryRow } from "~/server/workflow/inquiry/repo";
import { reviewLead } from "~/server/workflow/lead/domain/decide";
import type { LeadHistoryEventDraft } from "~/server/workflow/lead/domain/history";
import type { LeadState } from "~/server/workflow/lead/domain/state";
import type { LeadChange } from "~/server/workflow/lead/write/commit";

import type { ImportRowInput } from "./types";

const IMPORT_REASON = "Imported from CSV";

export type RecordImportPlan = {
  applied: number;
  answered: InquiryRow[];
  newlyAnswered: InquiryRow[];
  leads: LeadChange[];
  events: LeadHistoryEventDraft[];
};

/** Folds a batch's lines, in file order, over the active leads and live
 * inquiries of their RUCs, so a later line sees what an earlier one changed.
 * A line applies when it answers an inquiry or reviews a lead in QUALIFYING. */
export function planRecordImport(input: {
  rows: readonly ImportRowInput[];
  actor: WorkflowActor;
  operationAt: Date;
  leads: readonly LeadState[];
  inquiries: readonly InquiryRow[];
}): RecordImportPlan {
  const leads = new Map(input.leads.map((lead) => [lead.ruc as string, lead]));
  const inquiries = Map.groupBy(input.inquiries, (inquiry) => inquiry.ruc);
  const answered = new Map<WorkflowInquiryId, InquiryRow>();
  const changes = new Map<string, LeadChange>();
  const newlyAnswered: InquiryRow[] = [];
  const events: LeadHistoryEventDraft[] = [];
  let applied = 0;

  for (const row of input.rows) {
    const status = row.type === "import_status" ? row.status : undefined;
    const priority = row.type === "import_prioridad" ? row.priority : undefined;

    const live = inquiries.get(row.ruc) ?? [];
    for (const [index, before] of live.entries()) {
      const after = answerInquiry(before, {
        status,
        priority,
        answeredBy: input.actor.userId,
        answeredAt: input.operationAt,
      });
      live[index] = after;
      answered.set(after.id, after);
      if (before.state === "PENDING" && after.state === "ANSWERED") {
        newlyAnswered.push(after);
      }
    }

    const lead = leads.get(row.ruc);
    const reviewed =
      lead?.stage === "QUALIFYING"
        ? reviewLead(lead, {
            actor: input.actor,
            rowType: status === undefined ? "priority" : "status",
            status: status ?? lead.status,
            priority: priority ?? lead.priority,
            reason: IMPORT_REASON,
            occurredAt: input.operationAt,
          })
        : undefined;
    if (lead && reviewed?.ok) {
      const { next } = reviewed.value;
      leads.set(row.ruc, next);
      changes.set(next.id, {
        fromVersion: changes.get(next.id)?.fromVersion ?? lead.version,
        next,
      });
      events.push(...reviewed.value.events);
    }

    if (live.length > 0 || reviewed?.ok) {
      applied++;
    }
  }

  return {
    applied,
    answered: [...answered.values()],
    newlyAnswered,
    leads: [...changes.values()],
    events,
  };
}
