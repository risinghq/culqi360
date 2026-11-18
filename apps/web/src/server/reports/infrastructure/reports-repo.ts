import { sql, type Kysely } from "kysely";

import { personDisplayName, shortName } from "~/domain/identity/display-name";
import type {
  ActivityOutcomeId,
  BranchId,
  CaseTypeId,
  UserId,
} from "~/domain/ids";
import type { InstantRange } from "~/domain/time/app-time";
import type {
  ActivityChannel,
  Database,
} from "~/server/platform/database/types";

// Whose rows a report shows: the viewer's own, the users of one branch, or
// the whole workspace.
export type ReportReach =
  | { kind: "own"; userId: UserId }
  | { kind: "branch"; branchId: BranchId }
  | { kind: "all" };

export type ReportUser = { id: UserId; name: string };

// One holder's cases that share a status of the counted stage. A null status
// means the stage has not started.
export type ProductionCount = {
  holderUserId: UserId;
  holderName: string;
  status: string | null;
  cases: number;
  sum: number | null;
};

export type ProductionFilter = {
  caseTypeId: CaseTypeId;
  stageKey: string;
  sumFieldKey: string | null;
  opened: InstantRange;
  reach: ReportReach;
};

export type ActivityFilter = {
  range: InstantRange;
  reach: ReportReach;
  userId: UserId | null;
  channel: ActivityChannel | null;
  outcomeId: ActivityOutcomeId | null;
  limit: number | null;
};

export type ActivityRow = {
  startedAt: Date;
  channel: ActivityChannel;
  userName: string;
  ruc: string;
  legalName: string | null;
  contactName: string | null;
  phone: string | null;
  subject: string | null;
  outcomeLabel: string | null;
  durationSeconds: number | null;
  notes: string | null;
};

export type ReportOutcome = {
  id: ActivityOutcomeId;
  label: string;
  channel: ActivityChannel;
};

export function createReportsRepo(db: Kysely<Database>) {
  return {
    async listUsers(reach: ReportReach): Promise<ReportUser[]> {
      let query = db
        .selectFrom("users")
        .select(["id", "names", "first_surname", "second_surname"])
        .orderBy("names")
        .orderBy("first_surname");
      if (reach.kind === "own") {
        query = query.where("id", "=", reach.userId);
      } else if (reach.kind === "branch") {
        query = query.where("branch_id", "=", reach.branchId);
      }
      const rows = await query.execute();
      return rows.map((row) => ({ id: row.id, name: shortName(row) }));
    },

    async listOutcomes(): Promise<ReportOutcome[]> {
      return db
        .selectFrom("activity_outcomes")
        .select(["id", "label", "channel"])
        .orderBy("channel")
        .orderBy("position")
        .execute();
    },

    // Branch reach follows the holder's branch now, so a case counts where
    // its holder works.
    async countProduction(
      filter: ProductionFilter,
    ): Promise<ProductionCount[]> {
      const sumField = filter.sumFieldKey;
      let query = db
        .selectFrom("cases as c")
        .innerJoin("users as holder", "holder.id", "c.holder_user_id")
        .leftJoin("case_stage_states as s", (join) =>
          join
            .onRef("s.case_id", "=", "c.id")
            .on("s.stage_key", "=", filter.stageKey),
        )
        .select((eb) => [
          "c.holder_user_id",
          "holder.names",
          "holder.first_surname",
          "holder.second_surname",
          "s.status",
          eb.fn.countAll<string>().as("cases"),
          (sumField === null
            ? sql<string | null>`null`
            : sql<
                string | null
              >`coalesce(sum(case when jsonb_typeof(c.values -> ${sumField}) = 'number' then (c.values ->> ${sumField})::numeric end), 0)`
          ).as("sum"),
        ])
        .where("c.case_type_id", "=", filter.caseTypeId)
        .where("c.created_at", ">=", filter.opened.start)
        .where("c.created_at", "<", filter.opened.endExclusive)
        .groupBy([
          "c.holder_user_id",
          "holder.names",
          "holder.first_surname",
          "holder.second_surname",
          "s.status",
        ]);
      if (filter.reach.kind === "own") {
        query = query.where("c.holder_user_id", "=", filter.reach.userId);
      } else if (filter.reach.kind === "branch") {
        query = query.where("holder.branch_id", "=", filter.reach.branchId);
      }
      const rows = await query.execute();
      return rows.map((row) => ({
        holderUserId: row.holder_user_id,
        holderName: shortName(row),
        status: row.status,
        cases: Number(row.cases),
        sum: row.sum === null ? null : Number(row.sum),
      }));
    },

    // Newest first. Branch reach follows the branch the activity was logged
    // in.
    async listActivities(filter: ActivityFilter): Promise<ActivityRow[]> {
      let query = db
        .selectFrom("activities as a")
        .innerJoin("users as u", "u.id", "a.user_id")
        .innerJoin("organizations as o", "o.id", "a.organization_id")
        .leftJoin("contacts as ct", "ct.id", "a.contact_id")
        .leftJoin("people as p", "p.id", "ct.person_id")
        .leftJoin("activity_outcomes as oc", "oc.id", "a.outcome_id")
        .leftJoin("cases as k", "k.id", "a.case_id")
        .leftJoin("case_types as kt", "kt.id", "k.case_type_id")
        .leftJoin("campaign_records as r", "r.id", "a.campaign_record_id")
        .leftJoin("campaigns as g", "g.id", "r.campaign_id")
        .select([
          "a.started_at",
          "a.channel",
          "a.phone",
          "a.duration_seconds",
          "a.notes",
          "u.names",
          "u.first_surname",
          "u.second_surname",
          "o.ruc",
          "o.legal_name",
          "p.names as person_names",
          "p.first_surname as person_first_surname",
          "p.second_surname as person_second_surname",
          "oc.label as outcome_label",
          "kt.name as case_type_name",
          "g.name as campaign_name",
        ])
        .where("a.started_at", ">=", filter.range.start)
        .where("a.started_at", "<", filter.range.endExclusive)
        .orderBy("a.started_at", "desc")
        .orderBy("a.id", "desc");
      if (filter.reach.kind === "own") {
        query = query.where("a.user_id", "=", filter.reach.userId);
      } else if (filter.reach.kind === "branch") {
        query = query.where("a.branch_id", "=", filter.reach.branchId);
      }
      if (filter.userId) {
        query = query.where("a.user_id", "=", filter.userId);
      }
      if (filter.channel) {
        query = query.where("a.channel", "=", filter.channel);
      }
      if (filter.outcomeId) {
        query = query.where("a.outcome_id", "=", filter.outcomeId);
      }
      if (filter.limit !== null) {
        query = query.limit(filter.limit);
      }
      const rows = await query.execute();
      return rows.map((row) => ({
        startedAt: row.started_at,
        channel: row.channel,
        userName: shortName(row),
        ruc: row.ruc,
        legalName: row.legal_name,
        contactName:
          row.person_names === null
            ? null
            : personDisplayName({
                names: row.person_names,
                first_surname: row.person_first_surname,
                second_surname: row.person_second_surname,
              }),
        phone: row.phone,
        subject: row.case_type_name ?? row.campaign_name,
        outcomeLabel: row.outcome_label,
        durationSeconds: row.duration_seconds,
        notes: row.notes,
      }));
    },
  };
}

export type ReportsRepo = ReturnType<typeof createReportsRepo>;
