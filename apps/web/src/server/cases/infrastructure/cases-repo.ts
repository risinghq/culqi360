import type { Kysely } from "kysely";

import type { Role } from "~/domain/auth/access/rbac";
import type { CaseId, CaseTypeId, OrganizationId, UserId } from "~/domain/ids";
import type { Database } from "~/server/platform/database/types";

import type { CaseProgress, CaseValues } from "../domain/decide";
import type { CaseTypeDefinition } from "../domain/definition";

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

  return {
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
