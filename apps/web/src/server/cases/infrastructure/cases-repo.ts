import { sql, type ExpressionBuilder, type Kysely } from "kysely";

import type { CaseValues } from "~/domain/cases/field-rules";
import { shortName } from "~/domain/identity/display-name";
import {
  FileAssetId,
  type BranchId,
  type CaseId,
  type CaseTypeId,
  type OrganizationId,
  type UserId,
  type WorkspaceId,
} from "~/domain/ids";
import type { Database } from "~/server/platform/database/types";

import type { CaseProgress, StageDeadlines } from "../domain/decide";
import {
  stageGates,
  type CaseStageDefinition,
  type CaseStageGate,
  type CaseTypeDefinition,
} from "../domain/definition";
import type { CaseEventKind } from "../domain/events";

type NameParts = {
  names: string | null;
  first_surname: string | null;
};

// A user removed from the workspace leaves no name.
function nameOf(row: NameParts): string | null {
  return row.names === null || row.first_surname === null
    ? null
    : `${row.names} ${row.first_surname}`;
}

export type CaseTypeSummary = {
  id: CaseTypeId;
  key: string;
  name: string;
};

// A case as a list shows it: the company, the holder and each stage's status.
export type CaseSummary = {
  id: CaseId;
  ruc: string;
  legalName: string | null;
  holderName: string;
  statuses: Record<string, string>;
  updatedAt: Date;
};

// A stage's last writer and time, and its deadline while its timeout counts.
// A timeout or an unattributed import leaves no writer.
export type StageRecord = {
  stageKey: string;
  userName: string | null;
  at: Date;
  dueAt: Date | null;
};

export type CaseDetail = CaseSummary & {
  caseTypeId: CaseTypeId;
  organizationId: OrganizationId;
  holderUserId: UserId;
  version: number;
  values: CaseValues;
  createdAt: Date;
  stageRecords: StageRecord[];
};

// A case as a report shows it: every value, and each stage's status, last
// writer and time.
export type CaseReportRow = {
  ruc: string;
  legalName: string | null;
  holderName: string;
  createdAt: Date;
  updatedAt: Date;
  values: CaseValues;
  stages: Record<string, { status: string; userName: string | null; at: Date }>;
};

export type CaseListFilter = {
  caseTypeId: CaseTypeId;
  holderUserId: UserId | null;
};

export type CaseEvent = {
  kind: CaseEventKind;
  stageKey: string | null;
  status: string | null;
  actorName: string | null;
  holderName: string | null;
  at: Date;
};

export type NewCaseEvent = {
  caseId: CaseId;
  kind: CaseEventKind;
  stageKey?: string;
  status?: string;
  actorUserId: UserId | null;
  holderUserId?: UserId;
  at: Date;
};

// A stage whose deadline has passed, with the workspace the sweep runs it in.
export type DueStage = {
  caseId: CaseId;
  stageKey: string;
  workspaceId: WorkspaceId;
};

const DUE_BATCH = 200;

function fileAssetIds(values: readonly string[]): FileAssetId[] {
  return values.flatMap((value) => {
    const parsed = FileAssetId.parse(value);
    return parsed.ok ? [parsed.value] : [];
  });
}

const LIST_LIMIT = 200;

export type StoredCaseType = {
  id: CaseTypeId;
  definition: CaseTypeDefinition;
};

export type StoredCase = {
  id: CaseId;
  caseTypeId: CaseTypeId;
  organizationId: OrganizationId;
  holderUserId: UserId;
  version: number;
  progress: CaseProgress;
  deadlines: StageDeadlines;
};

export type NewCase = {
  caseTypeId: CaseTypeId;
  organizationId: OrganizationId;
  holderUserId: UserId;
  progress: CaseProgress;
  deadlines: StageDeadlines;
  actorUserId: UserId;
  at: Date;
};

// The stage a write changed, and the deadline of every timed stage. Other
// stages keep their row and its author. A timeout has no actor.
export type CaseUpdate = {
  id: CaseId;
  expectedVersion: number;
  values: CaseValues;
  stageKey: string;
  status: string;
  deadlines: StageDeadlines;
  actorUserId: UserId | null;
  at: Date;
};

// A case brought in from another system, with each stage's own writer and
// time. A stage the source never attributed has no writer.
export type ImportedStage = {
  stageKey: string;
  status: string;
  updatedBy: UserId | null;
  updatedAt: Date;
};

export type ImportedCase = {
  id: CaseId;
  organizationId: OrganizationId;
  holderUserId: UserId;
  values: CaseValues;
  createdAt: Date;
  updatedAt: Date;
  stages: readonly ImportedStage[];
};

// Postgres caps a statement at 65535 parameters; a chunk stays far below it.
const IMPORT_CHUNK = 500;

// A stage is waiting when it still holds its initial status and it is open:
// every gate on its chain holds one of the statuses that open it. A stage
// scoped by a branch field waits only for the branch the field names.
function waitingAt(
  stage: CaseStageDefinition,
  gates: readonly CaseStageGate[],
  branchId: BranchId,
) {
  return (eb: ExpressionBuilder<Database, "cases">) =>
    eb.and([
      stage.branchField === undefined
        ? eb.lit(true)
        : eb(sql<string>`cases.values ->> ${stage.branchField}`, "=", branchId),
      waitingFor(stage, gates)(eb),
    ]);
}

function waitingFor(
  stage: CaseStageDefinition,
  gates: readonly CaseStageGate[],
) {
  return (eb: ExpressionBuilder<Database, "cases">) =>
    eb.exists(
      eb
        .selectFrom("case_stage_states as s")
        .select("s.case_id")
        .whereRef("s.case_id", "=", "cases.id")
        .where("s.stage_key", "=", stage.key)
        .where("s.status", "=", stage.initialStatus)
        .where((inner) =>
          inner.and(
            gates.map((gate) =>
              inner.exists(
                inner
                  .selectFrom("case_stage_states as g")
                  .select("g.case_id")
                  .whereRef("g.case_id", "=", "cases.id")
                  .where("g.stage_key", "=", gate.stageKey)
                  .where("g.status", "in", [...gate.statuses]),
              ),
            ),
          ),
        ),
    );
}

export function createCasesRepo(db: Kysely<Database>) {
  async function loadDefinition(
    caseType: { id: CaseTypeId; key: string; name: string } | undefined,
  ): Promise<StoredCaseType | null> {
    if (!caseType) {
      return null;
    }
    const [stages, fields] = await Promise.all([
      db
        .selectFrom("case_stages")
        .selectAll()
        .where("case_type_id", "=", caseType.id)
        .orderBy("position")
        .execute(),
      db
        .selectFrom("case_fields")
        .selectAll()
        .where("case_type_id", "=", caseType.id)
        .orderBy("position")
        .execute(),
    ]);
    return {
      id: caseType.id,
      definition: {
        key: caseType.key,
        name: caseType.name,
        stages: stages.map((stage) => ({
          key: stage.key,
          name: stage.name,
          ownerRole: stage.owner_role,
          statuses: stage.statuses,
          initialStatus: stage.initial_status,
          gate:
            stage.gate_stage_key === null
              ? null
              : {
                  stageKey: stage.gate_stage_key,
                  statuses: stage.gate_statuses ?? [],
                },
          branchField: stage.branch_field ?? undefined,
          timeout: stage.timeout ?? undefined,
        })),
        fields: fields.map((field) => ({
          key: field.key,
          stageKey: field.stage_key,
          label: field.label,
          kind: field.kind,
          choices: field.choices,
          required: field.required,
          requiredWhen: field.required_when ?? undefined,
          bounds: field.bounds ?? undefined,
          amendableWhile: field.amendable_while ?? undefined,
          correctedBy: field.corrected_by,
        })),
      },
    };
  }

  const summaryQuery = () =>
    db
      .selectFrom("cases as c")
      .innerJoin("organizations as org", "org.id", "c.organization_id")
      .innerJoin("users as holder", "holder.id", "c.holder_user_id")
      .select([
        "c.id",
        "c.case_type_id",
        "c.organization_id",
        "c.holder_user_id",
        "c.version",
        "c.values",
        "c.created_at",
        "c.updated_at",
        "org.ruc",
        "org.legal_name",
        "holder.names",
        "holder.first_surname",
        "holder.second_surname",
        sql<Record<string, string>>`(
          select jsonb_object_agg(s.stage_key, s.status)
          from case_stage_states s
          where s.case_id = c.id
        )`.as("statuses"),
      ]);

  type SummaryRow = Awaited<
    ReturnType<ReturnType<typeof summaryQuery>["executeTakeFirstOrThrow"]>
  >;

  const toSummary = (row: SummaryRow): CaseSummary => ({
    id: row.id,
    ruc: row.ruc,
    legalName: row.legal_name,
    holderName: shortName(row),
    statuses: row.statuses,
    updatedAt: row.updated_at,
  });

  return {
    async listCaseTypes(): Promise<CaseTypeSummary[]> {
      return db
        .selectFrom("case_types")
        .select(["id", "key", "name"])
        .orderBy("name")
        .execute();
    },

    // Newest activity first. A null holder lists every case of the type.
    async listCases(filter: CaseListFilter): Promise<CaseSummary[]> {
      let query = summaryQuery()
        .where("c.case_type_id", "=", filter.caseTypeId)
        .orderBy("c.updated_at", "desc")
        .limit(LIST_LIMIT);
      if (filter.holderUserId) {
        query = query.where("c.holder_user_id", "=", filter.holderUserId);
      }
      return (await query.execute()).map(toSummary);
    },

    // Every case of the filter, oldest filing first. A report has no list
    // limit.
    async listCaseReport(filter: CaseListFilter): Promise<CaseReportRow[]> {
      let query = db
        .selectFrom("cases as c")
        .innerJoin("organizations as org", "org.id", "c.organization_id")
        .innerJoin("users as holder", "holder.id", "c.holder_user_id")
        .select([
          "c.values",
          "c.created_at",
          "c.updated_at",
          "org.ruc",
          "org.legal_name",
          "holder.names",
          "holder.first_surname",
          "holder.second_surname",
          sql<
            Record<
              string,
              { status: string; userName: string | null; at: string }
            >
          >`(
            select jsonb_object_agg(s.stage_key, jsonb_build_object(
              'status', s.status,
              'userName', nullif(concat_ws(' ', author.names, author.first_surname), ''),
              'at', s.updated_at
            ))
            from case_stage_states s
            left join users author on author.id = s.updated_by
            where s.case_id = c.id
          )`.as("stages"),
        ])
        .where("c.case_type_id", "=", filter.caseTypeId)
        .orderBy("c.created_at")
        .orderBy("c.id");
      if (filter.holderUserId) {
        query = query.where("c.holder_user_id", "=", filter.holderUserId);
      }
      const rows = await query.execute();
      return rows.map((row) => ({
        ruc: row.ruc,
        legalName: row.legal_name,
        holderName: shortName(row),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        values: row.values,
        // jsonb carries the time as an ISO string.
        stages: Object.fromEntries(
          Object.entries(row.stages).map(([key, stage]) => [
            key,
            {
              status: stage.status,
              userName: stage.userName,
              at: new Date(stage.at),
            },
          ]),
        ),
      }));
    },

    async listBranches(): Promise<{ id: BranchId; name: string }[]> {
      return db
        .selectFrom("branches")
        .select(["id", "name"])
        .orderBy("name")
        .execute();
    },

    // The workspace's role names by key, for the stage owner a case shows.
    async listRoleNames(): Promise<Map<string, string>> {
      const rows = await db
        .selectFrom("workspace_roles")
        .select(["key", "name"])
        .execute();
      return new Map(rows.map((row) => [row.key, row.name]));
    },

    async listBranchIds(): Promise<Set<string>> {
      const rows = await db.selectFrom("branches").select("id").execute();
      return new Set(rows.map((row) => row.id));
    },

    // The cases waiting at any of the stages for a user in the branch, oldest
    // activity first.
    async listWaiting(
      caseTypeId: CaseTypeId,
      definition: CaseTypeDefinition,
      stages: readonly CaseStageDefinition[],
      branchId: BranchId,
    ): Promise<CaseSummary[]> {
      if (stages.length === 0) {
        return [];
      }
      const rows = await summaryQuery()
        .where("c.case_type_id", "=", caseTypeId)
        .where("c.id", "in", (eb) =>
          eb
            .selectFrom("cases")
            .select("cases.id")
            .where((inner) =>
              inner.or(
                stages.map((stage) =>
                  waitingAt(
                    stage,
                    stageGates(definition, stage),
                    branchId,
                  )(inner),
                ),
              ),
            ),
        )
        .orderBy("c.updated_at", "asc")
        .limit(LIST_LIMIT)
        .execute();
      return rows.map(toSummary);
    },

    async findCaseDetail(id: CaseId): Promise<CaseDetail | null> {
      const row = await summaryQuery()
        .where("c.id", "=", id)
        .executeTakeFirst();
      if (!row) {
        return null;
      }
      const records = await db
        .selectFrom("case_stage_states as s")
        .leftJoin("users as author", "author.id", "s.updated_by")
        .select([
          "s.stage_key",
          "s.updated_at",
          "s.due_at",
          "author.names",
          "author.first_surname",
        ])
        .where("s.case_id", "=", id)
        .execute();
      return {
        ...toSummary(row),
        caseTypeId: row.case_type_id,
        organizationId: row.organization_id,
        holderUserId: row.holder_user_id,
        version: row.version,
        values: row.values,
        createdAt: row.created_at,
        stageRecords: records.map((record) => ({
          stageKey: record.stage_key,
          userName: nameOf(record),
          at: record.updated_at,
          dueAt: record.due_at,
        })),
      };
    },

    // Oldest first, so the history reads in the order it happened.
    async listEvents(caseId: CaseId): Promise<CaseEvent[]> {
      const rows = await db
        .selectFrom("case_events as e")
        .leftJoin("users as actor", "actor.id", "e.actor_user_id")
        .leftJoin("users as holder", "holder.id", "e.holder_user_id")
        .select([
          "e.kind",
          "e.stage_key",
          "e.status",
          "e.at",
          "actor.names as actor_names",
          "actor.first_surname as actor_first_surname",
          "holder.names as holder_names",
          "holder.first_surname as holder_first_surname",
        ])
        .where("e.case_id", "=", caseId)
        .orderBy("e.at")
        .orderBy("e.id")
        .execute();
      return rows.map((row) => ({
        kind: row.kind,
        stageKey: row.stage_key,
        status: row.status,
        actorName: nameOf({
          names: row.actor_names,
          first_surname: row.actor_first_surname,
        }),
        holderName: nameOf({
          names: row.holder_names,
          first_surname: row.holder_first_surname,
        }),
        at: row.at,
      }));
    },

    async insertEvent(event: NewCaseEvent): Promise<void> {
      await db
        .insertInto("case_events")
        .values({
          case_id: event.caseId,
          kind: event.kind,
          stage_key: event.stageKey ?? null,
          status: event.status ?? null,
          actor_user_id: event.actorUserId,
          holder_user_id: event.holderUserId ?? null,
          at: event.at,
        })
        .execute();
    },

    // A user who could hold a case: active, with the role of its opening
    // stage. Null for a user the workspace does not have.
    async findHolderCandidate(
      userId: UserId,
    ): Promise<{ active: boolean; roleKey: string } | null> {
      const row = await db
        .selectFrom("users as u")
        .innerJoin("workspace_roles as r", "r.id", "u.role_id")
        .select(["u.is_active", "r.key"])
        .where("u.id", "=", userId)
        .executeTakeFirst();
      return row ? { active: row.is_active, roleKey: row.key } : null;
    },

    async listHolderCandidates(
      roleKey: string,
    ): Promise<{ id: UserId; name: string }[]> {
      const rows = await db
        .selectFrom("users as u")
        .innerJoin("workspace_roles as r", "r.id", "u.role_id")
        .select(["u.id", "u.names", "u.first_surname", "u.second_surname"])
        .where("r.key", "=", roleKey)
        .where("u.is_active", "=", true)
        .orderBy("u.names")
        .orderBy("u.first_surname")
        .execute();
      return rows.map((row) => ({ id: row.id, name: shortName(row) }));
    },

    // Returns false when another write moved the case past expectedVersion.
    async updateHolder(input: {
      id: CaseId;
      expectedVersion: number;
      holderUserId: UserId;
      at: Date;
    }): Promise<boolean> {
      const updated = await db
        .updateTable("cases")
        .set({
          holder_user_id: input.holderUserId,
          version: input.expectedVersion + 1,
          updated_at: input.at,
        })
        .where("id", "=", input.id)
        .where("version", "=", input.expectedVersion)
        .executeTakeFirst();
      return updated.numUpdatedRows > 0n;
    },

    // The case_file assets among the values that the user uploaded. A value
    // that is no id matches nothing.
    async listOwnCaseFileIds(
      userId: UserId,
      values: readonly string[],
    ): Promise<Set<string>> {
      const ids = fileAssetIds(values);
      if (ids.length === 0) {
        return new Set();
      }
      const rows = await db
        .selectFrom("file_assets")
        .select("id")
        .where("id", "in", ids)
        .where("purpose", "=", "case_file")
        .where("created_by_user_id", "=", userId)
        .execute();
      return new Set(rows.map((row) => row.id));
    },

    async listFileNames(
      values: readonly string[],
    ): Promise<Map<string, string>> {
      const ids = fileAssetIds(values);
      if (ids.length === 0) {
        return new Map();
      }
      const rows = await db
        .selectFrom("file_assets")
        .select(["id", "safe_display_filename"])
        .where("id", "in", ids)
        .execute();
      return new Map(rows.map((row) => [row.id, row.safe_display_filename]));
    },

    // Runs as platform: it lists every workspace's due stages for the sweep.
    async listDueStages(at: Date): Promise<DueStage[]> {
      const rows = await db
        .selectFrom("case_stage_states")
        .select(["case_id", "stage_key", "workspace_id"])
        .where("due_at", "<=", at)
        .orderBy("due_at")
        .limit(DUE_BATCH)
        .execute();
      return rows.map((row) => ({
        caseId: row.case_id,
        stageKey: row.stage_key,
        workspaceId: row.workspace_id,
      }));
    },

    async findCaseTypeByKey(key: string): Promise<StoredCaseType | null> {
      const caseType = await db
        .selectFrom("case_types")
        .select(["id", "key", "name"])
        .where("key", "=", key)
        .executeTakeFirst();
      return loadDefinition(caseType);
    },

    async findCaseTypeById(id: CaseTypeId): Promise<StoredCaseType | null> {
      const caseType = await db
        .selectFrom("case_types")
        .select(["id", "key", "name"])
        .where("id", "=", id)
        .executeTakeFirst();
      return loadDefinition(caseType);
    },

    async insertCaseType(
      definition: CaseTypeDefinition,
      at: Date,
    ): Promise<CaseTypeId> {
      const { id } = await db
        .insertInto("case_types")
        .values({ key: definition.key, name: definition.name, created_at: at })
        .returning("id")
        .executeTakeFirstOrThrow();
      await db
        .insertInto("case_stages")
        .values(
          definition.stages.map((stage, position) => ({
            case_type_id: id,
            key: stage.key,
            name: stage.name,
            position,
            owner_role: stage.ownerRole,
            statuses: [...stage.statuses],
            initial_status: stage.initialStatus,
            gate_stage_key: stage.gate?.stageKey ?? null,
            gate_statuses: stage.gate ? [...stage.gate.statuses] : null,
            branch_field: stage.branchField ?? null,
            timeout: stage.timeout ?? null,
          })),
        )
        .execute();
      if (definition.fields.length > 0) {
        await db
          .insertInto("case_fields")
          .values(
            definition.fields.map((field, position) => ({
              case_type_id: id,
              stage_key: field.stageKey,
              key: field.key,
              label: field.label,
              kind: field.kind,
              choices: field.choices ? [...field.choices] : null,
              required: field.required,
              required_when: field.requiredWhen ?? null,
              bounds: field.bounds ?? null,
              amendable_while: field.amendableWhile
                ? {
                    stageKey: field.amendableWhile.stageKey,
                    statuses: [...field.amendableWhile.statuses],
                  }
                : null,
              corrected_by: [...(field.correctedBy ?? [])],
              position,
            })),
          )
          .execute();
      }
      return id;
    },

    async findCase(id: CaseId): Promise<StoredCase | null> {
      const row = await db
        .selectFrom("cases")
        .select([
          "id",
          "case_type_id",
          "organization_id",
          "holder_user_id",
          "values",
          "version",
        ])
        .where("id", "=", id)
        .executeTakeFirst();
      if (!row) {
        return null;
      }
      const states = await db
        .selectFrom("case_stage_states")
        .select(["stage_key", "status", "due_at"])
        .where("case_id", "=", id)
        .execute();
      return {
        id: row.id,
        caseTypeId: row.case_type_id,
        organizationId: row.organization_id,
        holderUserId: row.holder_user_id,
        version: row.version,
        progress: {
          values: row.values,
          statuses: Object.fromEntries(
            states.map((state) => [state.stage_key, state.status]),
          ),
        },
        deadlines: Object.fromEntries(
          states.map((state) => [state.stage_key, state.due_at]),
        ),
      };
    },

    async insertCase(input: NewCase): Promise<CaseId> {
      const { id } = await db
        .insertInto("cases")
        .values({
          case_type_id: input.caseTypeId,
          organization_id: input.organizationId,
          holder_user_id: input.holderUserId,
          values: input.progress.values,
          created_at: input.at,
          updated_at: input.at,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await db
        .insertInto("case_stage_states")
        .values(
          Object.entries(input.progress.statuses).map(([stageKey, status]) => ({
            case_id: id,
            case_type_id: input.caseTypeId,
            stage_key: stageKey,
            status,
            updated_by: input.actorUserId,
            updated_at: input.at,
            due_at: input.deadlines[stageKey] ?? null,
          })),
        )
        .execute();
      return id;
    },

    async importCases(
      caseTypeId: CaseTypeId,
      cases: readonly ImportedCase[],
    ): Promise<void> {
      for (let start = 0; start < cases.length; start += IMPORT_CHUNK) {
        const chunk = cases.slice(start, start + IMPORT_CHUNK);
        // Chunks share the caller's transaction and run in order.
        // eslint-disable-next-line no-await-in-loop
        await db
          .insertInto("cases")
          .values(
            chunk.map((imported) => ({
              id: imported.id,
              case_type_id: caseTypeId,
              organization_id: imported.organizationId,
              holder_user_id: imported.holderUserId,
              values: imported.values,
              created_at: imported.createdAt,
              updated_at: imported.updatedAt,
            })),
          )
          .execute();
        // eslint-disable-next-line no-await-in-loop
        await db
          .insertInto("case_stage_states")
          .values(
            chunk.flatMap((imported) =>
              imported.stages.map((stage) => ({
                case_id: imported.id,
                case_type_id: caseTypeId,
                stage_key: stage.stageKey,
                status: stage.status,
                updated_by: stage.updatedBy,
                updated_at: stage.updatedAt,
              })),
            ),
          )
          .execute();
      }
    },

    // Returns false when another write moved the case past expectedVersion.
    async updateCase(update: CaseUpdate): Promise<boolean> {
      const updated = await db
        .updateTable("cases")
        .set({
          values: update.values,
          version: update.expectedVersion + 1,
          updated_at: update.at,
        })
        .where("id", "=", update.id)
        .where("version", "=", update.expectedVersion)
        .executeTakeFirst();
      if (updated.numUpdatedRows === 0n) {
        return false;
      }
      await db
        .updateTable("case_stage_states")
        .set({
          status: update.status,
          updated_by: update.actorUserId,
          updated_at: update.at,
        })
        .where("case_id", "=", update.id)
        .where("stage_key", "=", update.stageKey)
        .execute();
      for (const [stageKey, dueAt] of Object.entries(update.deadlines)) {
        // A transaction runs one statement at a time; a case has few timed
        // stages.
        // eslint-disable-next-line no-await-in-loop
        await db
          .updateTable("case_stage_states")
          .set({ due_at: dueAt })
          .where("case_id", "=", update.id)
          .where("stage_key", "=", stageKey)
          .execute();
      }
      return true;
    },
  };
}

export type CasesRepo = ReturnType<typeof createCasesRepo>;
