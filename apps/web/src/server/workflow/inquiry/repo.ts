import { sql } from "kysely";

import type {
  InquiryState,
  LeadPriority,
  LeadStatus,
} from "~/contracts/workflow/vocabulary";
import {
  type UserId,
  WorkflowInquiryId,
  type WorkflowLeadId,
} from "~/domain/ids";
import { listBatches } from "~/server/platform/database/batches";
import type { WorkspaceExecutor } from "~/server/platform/database/executor";

export type InquiryRow = {
  id: WorkflowInquiryId;
  ruc: string;
  executiveId: UserId;
  state: InquiryState;
  status: LeadStatus | null;
  priority: LeadPriority | null;
  answeredAt: Date | null;
  answeredBy: UserId | null;
  convertedLeadId: WorkflowLeadId | null;
  createdAt: Date;
};

type InquiryDbRow = {
  id: WorkflowInquiryId;
  ruc: string;
  executive_id: UserId;
  state: InquiryState;
  status: LeadStatus | null;
  priority: LeadPriority | null;
  answered_at: Date | null;
  answered_by: UserId | null;
  converted_lead_id: WorkflowLeadId | null;
  created_at: Date;
};

function toInquiry(row: InquiryDbRow): InquiryRow {
  return {
    id: row.id,
    ruc: row.ruc,
    executiveId: row.executive_id,
    state: row.state,
    status: row.status,
    priority: row.priority,
    answeredAt: row.answered_at,
    answeredBy: row.answered_by,
    convertedLeadId: row.converted_lead_id,
    createdAt: row.created_at,
  };
}

const INQUIRY_COLUMNS = [
  "id",
  "ruc",
  "executive_id",
  "state",
  "status",
  "priority",
  "answered_at",
  "answered_by",
  "converted_lead_id",
  "created_at",
] as const;

export function createInquiryRepo(db: WorkspaceExecutor) {
  return {
    // Returns undefined when the executive already has a live (non-converted)
    // inquiry for the RUC: the partial unique index absorbs the race and the
    // caller maps the miss to a duplicate error.
    async insert(values: {
      ruc: string;
      executiveId: UserId;
      createdAt: Date;
    }): Promise<{ id: WorkflowInquiryId } | undefined> {
      const row = await db
        .insertInto("workflow_inquiries")
        .values({
          id: WorkflowInquiryId.mint(),
          ruc: values.ruc,
          executive_id: values.executiveId,
          state: "PENDING",
          created_at: values.createdAt,
          updated_at: values.createdAt,
        })
        .onConflict((oc) =>
          oc
            .columns(["executive_id", "ruc"])
            // SQLite matches the partial index only when this WHERE is the
            // index's own literal predicate; a bound parameter does not match.
            .where(sql.ref("state"), "!=", sql.lit("CONVERTED"))
            .doNothing(),
        )
        .returning("id")
        .executeTakeFirst();

      return row;
    },

    async findById(id: WorkflowInquiryId): Promise<InquiryRow | undefined> {
      const row = await db
        .selectFrom("workflow_inquiries")
        .select(INQUIRY_COLUMNS)
        .where("id", "=", id)
        .executeTakeFirst();
      return row ? toInquiry(row) : undefined;
    },

    async findLiveForExecutive(
      ruc: string,
      executiveId: UserId,
    ): Promise<InquiryRow | undefined> {
      const row = await db
        .selectFrom("workflow_inquiries")
        .select(INQUIRY_COLUMNS)
        .where("ruc", "=", ruc)
        .where("executive_id", "=", executiveId)
        .where("state", "!=", "CONVERTED")
        .executeTakeFirst();
      return row ? toInquiry(row) : undefined;
    },

    async markConverted(
      id: WorkflowInquiryId,
      leadId: WorkflowLeadId,
      convertedAt: Date,
    ): Promise<void> {
      await db
        .updateTable("workflow_inquiries")
        .set({
          state: "CONVERTED",
          converted_lead_id: leadId,
          updated_at: convertedAt,
        })
        .where("id", "=", id)
        .execute();
    },

    async listLiveByRucs(rucs: readonly string[]): Promise<InquiryRow[]> {
      const rows: InquiryDbRow[] = [];
      for (const batch of listBatches(rucs, 1)) {
        // eslint-disable-next-line no-await-in-loop
        const found = await db
          .selectFrom("workflow_inquiries")
          .select(INQUIRY_COLUMNS)
          .where("ruc", "in", batch)
          .where("state", "!=", "CONVERTED")
          .execute();
        rows.push(...found);
      }
      return rows.map(toInquiry);
    },

    // One statement for any number of inquiries: the answers travel as one
    // JSON parameter, so the binding limit does not split them.
    async saveAnswers(
      inquiries: readonly InquiryRow[],
      updatedAt: Date,
    ): Promise<void> {
      if (inquiries.length === 0) {
        return;
      }
      const answers = JSON.stringify(
        inquiries.map((inquiry) => ({
          id: inquiry.id,
          state: inquiry.state,
          status: inquiry.status,
          priority: inquiry.priority,
          answered_at: inquiry.answeredAt,
          answered_by: inquiry.answeredBy,
        })),
      );
      await db
        .updateTable("workflow_inquiries")
        .from(sql`json_each(${answers})`.as("answer"))
        .set({
          state: sql`answer.value ->> 'state'`,
          status: sql`answer.value ->> 'status'`,
          priority: sql`answer.value ->> 'priority'`,
          answered_at: sql`answer.value ->> 'answered_at'`,
          answered_by: sql`answer.value ->> 'answered_by'`,
          updated_at: updatedAt,
        })
        .where(
          "workflow_inquiries.id",
          "=",
          sql<WorkflowInquiryId>`answer.value ->> 'id'`,
        )
        .execute();
    },
  };
}
