import { sql, type ExpressionBuilder, type Kysely } from "kysely";

import type { Role } from "~/domain/auth/access/rbac";
import { shortName } from "~/domain/identity/display-name";
import type { CaseId, CaseTypeId, OrganizationId, UserId } from "~/domain/ids";
import type { Database } from "~/server/platform/database/types";

import type { CaseProgress, CaseValues } from "../domain/decide";
import type {
  CaseStageDefinition,
  CaseTypeDefinition,
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

// A stage is waiting when it still holds its initial status and its gate
// holds one of the statuses that open it.
function waitingAt(stage: CaseStageDefinition) {
  return (eb: ExpressionBuilder<Database, "cases">) =>
    eb.exists(
      eb
        .selectFrom("case_stage_states as s")
        .select("s.case_id")
        .whereRef("s.case_id", "=", "cases.id")
        .where("s.stage_key", "=", stage.key)
        .where("s.status", "=", stage.initialStatus)
        .where((inner) =>
          stage.gate
            ? inner.exists(
                inner
                  .selectFrom("case_stage_states as g")
                  .select("g.case_id")
                  .whereRef("g.case_id", "=", "cases.id")
                  .where("g.stage_key", "=", stage.gate.stageKey)
                  .where("g.status", "in", [...stage.gate.statuses]),
              )
            : inner.lit(true),
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
        })),
        fields: fields.map((field) => ({
          key: field.key,
          stageKey: field.stage_key,
          label: field.label,
          kind: field.kind,
          choices: field.choices,
          required: field.required,
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

    // The cases waiting at any of the stages, oldest activity first.
    async listWaiting(
      caseTypeId: CaseTypeId,
      stages: readonly CaseStageDefinition[],
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
              inner.or(stages.map((stage) => waitingAt(stage)(inner))),
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

    // A foreign key check ignores row-level security, so a case must confirm
    // its organization is visible in the workspace before it references it.
    async organizationExists(id: OrganizationId): Promise<boolean> {
      const row = await db
        .selectFrom("organizations")
        .select("id")
        .where("id", "=", id)
        .executeTakeFirst();
      return row !== undefined;
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
