import { sql, type ExpressionBuilder, type Kysely } from "kysely";

import type { Role } from "~/domain/auth/access/rbac";
import type { CaseValues } from "~/domain/cases/field-rules";
import { shortName } from "~/domain/identity/display-name";
import type {
  BranchId,
  CaseId,
  CaseTypeId,
  OrganizationId,
  UserId,
} from "~/domain/ids";
import type { Database } from "~/server/platform/database/types";

import type { CaseProgress } from "../domain/decide";
import {
  stageGates,
  type CaseStageDefinition,
  type CaseStageGate,
  type CaseTypeDefinition,
} from "../domain/definition";

export type CaseTypeSummary = {
  id: CaseTypeId;
  key: string;
  name: string;
};

// A case as a list shows it: the company, the owner and each stage's status.
export type CaseSummary = {
  id: CaseId;
  ruc: string;
  legalName: string | null;
  ownerName: string;
  statuses: Record<string, string>;
  updatedAt: Date;
};

export type StageAuthor = {
  stageKey: string;
  userName: string | null;
  at: Date;
};

export type CaseDetail = CaseSummary & {
  caseTypeId: CaseTypeId;
  organizationId: OrganizationId;
  ownerUserId: UserId;
  version: number;
  values: CaseValues;
  createdAt: Date;
  authors: StageAuthor[];
};

// A case as a report shows it: every value, and each stage's status, last
// writer and time.
export type CaseReportRow = {
  ruc: string;
  legalName: string | null;
  ownerName: string;
  createdAt: Date;
  updatedAt: Date;
  values: CaseValues;
  stages: Record<string, { status: string; userName: string | null; at: Date }>;
};

export type CaseListFilter = {
  caseTypeId: CaseTypeId;
  ownerUserId: UserId | null;
};

const LIST_LIMIT = 200;

export type StoredCaseType = {
  id: CaseTypeId;
  definition: CaseTypeDefinition;
};

export type StoredCase = {
  id: CaseId;
  caseTypeId: CaseTypeId;
  organizationId: OrganizationId;
  ownerUserId: UserId;
  version: number;
  progress: CaseProgress;
};

export type NewCase = {
  caseTypeId: CaseTypeId;
  organizationId: OrganizationId;
  ownerUserId: UserId;
  progress: CaseProgress;
  actorUserId: UserId;
  at: Date;
};

// The stage a write changed. Other stages keep their row and its author.
export type CaseUpdate = {
  id: CaseId;
  expectedVersion: number;
  values: CaseValues;
  stageKey: string;
  status: string;
  actorUserId: UserId;
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
  ownerUserId: UserId;
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
      .innerJoin("users as owner", "owner.id", "c.owner_user_id")
      .select([
        "c.id",
        "c.case_type_id",
        "c.organization_id",
        "c.owner_user_id",
        "c.version",
        "c.values",
        "c.created_at",
        "c.updated_at",
        "org.ruc",
        "org.legal_name",
        "owner.names",
        "owner.first_surname",
        "owner.second_surname",
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
    ownerName: shortName(row),
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

    // Newest activity first. A null owner lists every case of the type.
    async listCases(filter: CaseListFilter): Promise<CaseSummary[]> {
      let query = summaryQuery()
        .where("c.case_type_id", "=", filter.caseTypeId)
        .orderBy("c.updated_at", "desc")
        .limit(LIST_LIMIT);
      if (filter.ownerUserId) {
        query = query.where("c.owner_user_id", "=", filter.ownerUserId);
      }
      return (await query.execute()).map(toSummary);
    },

    // Every case of the filter, oldest filing first. A report has no list
    // limit.
    async listCaseReport(filter: CaseListFilter): Promise<CaseReportRow[]> {
      let query = db
        .selectFrom("cases as c")
        .innerJoin("organizations as org", "org.id", "c.organization_id")
        .innerJoin("users as owner", "owner.id", "c.owner_user_id")
        .select([
          "c.values",
          "c.created_at",
          "c.updated_at",
          "org.ruc",
          "org.legal_name",
          "owner.names",
          "owner.first_surname",
          "owner.second_surname",
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
      if (filter.ownerUserId) {
        query = query.where("c.owner_user_id", "=", filter.ownerUserId);
      }
      const rows = await query.execute();
      return rows.map((row) => ({
        ruc: row.ruc,
        legalName: row.legal_name,
        ownerName: shortName(row),
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
      const authors = await db
        .selectFrom("case_stage_states as s")
        .leftJoin("users as author", "author.id", "s.updated_by")
        .select([
          "s.stage_key",
          "s.updated_at",
          "author.names",
          "author.first_surname",
          "author.second_surname",
        ])
        .where("s.case_id", "=", id)
        .execute();
      return {
        ...toSummary(row),
        caseTypeId: row.case_type_id,
        organizationId: row.organization_id,
        ownerUserId: row.owner_user_id,
        version: row.version,
        values: row.values,
        createdAt: row.created_at,
        authors: authors.map((author) => ({
          stageKey: author.stage_key,
          userName:
            author.names === null || author.first_surname === null
              ? null
              : `${author.names} ${author.first_surname}`,
          at: author.updated_at,
        })),
      };
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
            owner_role: stage.ownerRole satisfies Role,
            statuses: [...stage.statuses],
            initial_status: stage.initialStatus,
            gate_stage_key: stage.gate?.stageKey ?? null,
            gate_statuses: stage.gate ? [...stage.gate.statuses] : null,
            branch_field: stage.branchField ?? null,
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
          "owner_user_id",
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
        .select(["stage_key", "status"])
        .where("case_id", "=", id)
        .execute();
      return {
        id: row.id,
        caseTypeId: row.case_type_id,
        organizationId: row.organization_id,
        ownerUserId: row.owner_user_id,
        version: row.version,
        progress: {
          values: row.values,
          statuses: Object.fromEntries(
            states.map((state) => [state.stage_key, state.status]),
          ),
        },
      };
    },

    async insertCase(input: NewCase): Promise<CaseId> {
      const { id } = await db
        .insertInto("cases")
        .values({
          case_type_id: input.caseTypeId,
          organization_id: input.organizationId,
          owner_user_id: input.ownerUserId,
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
              owner_user_id: imported.ownerUserId,
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
      return true;
    },
  };
}

export type CasesRepo = ReturnType<typeof createCasesRepo>;
