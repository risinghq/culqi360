import type {
  CaseDetailView,
  CaseFieldOption,
  CaseFieldView,
  CaseSummaryView,
  CaseTypeView,
} from "~/contracts/cases/views";
import { hasPermission } from "~/domain/auth/access/rbac";
import { CaseId, CaseTypeId } from "~/domain/ids";
import { getApplication } from "~/server/composition/application";
import { executeSessionServerFunction } from "~/server/platform/action";
import {
  parseObject,
  validationFail,
} from "~/server/platform/action/input-reader";
import { Ok } from "~/shared/result";

import type {
  CaseTypeOverview,
  CaseWithAccess,
} from "../application/read-cases";
import { editableFields, keepsRequired } from "../domain/decide";
import {
  openingStage,
  type CaseFieldDefinition,
  type CaseTypeDefinition,
} from "../domain/definition";
import type { CaseSummary } from "../infrastructure/cases-repo";

type Branch = { id: string; name: string };

function optionsOf(
  field: CaseFieldDefinition,
  branches: readonly Branch[],
): CaseFieldOption[] | null {
  if (field.kind === "branch") {
    return branches.map((branch) => ({ value: branch.id, label: branch.name }));
  }
  return field.choices
    ? field.choices.map((choice) => ({ value: choice, label: choice }))
    : null;
}

function toFieldView(
  field: CaseFieldDefinition,
  branches: readonly Branch[],
): CaseFieldView {
  return {
    key: field.key,
    stageKey: field.stageKey,
    label: field.label,
    kind: field.kind,
    options: optionsOf(field, branches),
    required: field.required,
    requiredWhen: field.requiredWhen ?? null,
    bounds: field.bounds ?? null,
  };
}

function fieldsOf(
  definition: CaseTypeDefinition,
  stageKey: string,
  branches: readonly Branch[],
): CaseFieldView[] {
  return definition.fields
    .filter((field) => field.stageKey === stageKey)
    .map((field) => toFieldView(field, branches));
}

function toCaseTypeView(
  caseType: CaseTypeOverview,
  branches: readonly Branch[],
): CaseTypeView {
  const { definition } = caseType;
  const opening = openingStage(definition);
  return {
    id: caseType.id,
    key: definition.key,
    name: definition.name,
    canOpen: caseType.canOpen,
    hasQueue: caseType.hasQueue,
    opening: {
      key: opening.key,
      name: opening.name,
      initialStatus: opening.initialStatus,
      fields: fieldsOf(definition, opening.key, branches),
    },
    stages: definition.stages.map((stage) => ({
      key: stage.key,
      name: stage.name,
    })),
  };
}

function toSummaryView(summary: CaseSummary): CaseSummaryView {
  return {
    id: summary.id,
    ruc: summary.ruc,
    legalName: summary.legalName,
    holderName: summary.holderName,
    statuses: summary.statuses,
    updatedAt: summary.updatedAt.getTime(),
  };
}

function toDetailView(
  {
    detail,
    definition,
    access,
    events,
    fileNames,
    holderCandidates,
  }: CaseWithAccess,
  branches: readonly Branch[],
  roleNames: ReadonlyMap<string, string>,
): CaseDetailView {
  const progress = { values: detail.values, statuses: detail.statuses };
  const stageNames = new Map(
    definition.stages.map((stage) => [stage.key, stage.name]),
  );
  return {
    id: detail.id,
    caseType: { key: definition.key, name: definition.name },
    organizationId: detail.organizationId,
    ruc: detail.ruc,
    legalName: detail.legalName,
    holderName: detail.holderName,
    holderUserId: detail.holderUserId,
    version: detail.version,
    values: { ...detail.values },
    fileNames: Object.fromEntries(fileNames),
    createdAt: detail.createdAt.getTime(),
    updatedAt: detail.updatedAt.getTime(),
    events: events.map((event) => ({
      kind: event.kind,
      stageName: event.stageKey
        ? (stageNames.get(event.stageKey) ?? event.stageKey)
        : null,
      status: event.status,
      actorName: event.actorName,
      holderName: event.holderName,
      at: event.at.getTime(),
    })),
    holderCandidates: holderCandidates.map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
    })),
    stages: definition.stages.map((stage) => {
      const record = detail.stageRecords.find(
        (each) => each.stageKey === stage.key,
      );
      const stageAccess = access[stage.key] ?? "not_owned";
      return {
        key: stage.key,
        name: stage.name,
        ownerRoleLabel: roleNames.get(stage.ownerRole) ?? stage.ownerRole,
        status: detail.statuses[stage.key] ?? stage.initialStatus,
        statuses: [...stage.statuses],
        initialStatus: stage.initialStatus,
        access: stageAccess,
        fields: fieldsOf(definition, stage.key, branches),
        editableFields: editableFields(definition, stage, progress).map(
          (field) => toFieldView(field, branches),
        ),
        keepsRequired: keepsRequired(stage, stageAccess),
        lastAuthor: record
          ? { name: record.userName, at: record.at.getTime() }
          : null,
        dueAt: record?.dueAt ? record.dueAt.getTime() : null,
      };
    }),
  };
}

const parseCaseType = (input: unknown) =>
  parseObject(input, validationFail, (r) => ({
    caseTypeId: r.id("caseTypeId", CaseTypeId),
  }));

export async function listCaseTypes(): Promise<CaseTypeView[]> {
  return executeSessionServerFunction({
    name: "cases.types",
    access: { kind: "permission", permission: "case:work" },
    execute: async (ctx) => {
      const { cases } = getApplication();
      const [types, branches] = await Promise.all([
        cases.types(ctx.actor.roleKey),
        cases.branches(),
      ]);
      return Ok(types.map((type) => toCaseTypeView(type, branches)));
    },
  });
}

export async function listCases(input: unknown): Promise<CaseSummaryView[]> {
  return executeSessionServerFunction({
    name: "cases.list",
    access: { kind: "permission", permission: "case:work" },
    parse: () => parseCaseType(input),
    execute: async (ctx, { caseTypeId }) => {
      const cases = await getApplication().cases.list({
        caseTypeId,
        actorUserId: ctx.actor.userId,
        viewAll: hasPermission(ctx.actor, "case:view:all"),
      });
      return Ok(cases.map(toSummaryView));
    },
  });
}

export async function listWaitingCases(
  input: unknown,
): Promise<CaseSummaryView[]> {
  return executeSessionServerFunction({
    name: "cases.waiting",
    access: { kind: "permission", permission: "case:work" },
    parse: () => parseCaseType(input),
    execute: async (ctx, { caseTypeId }) => {
      const waiting = await getApplication().cases.waiting({
        caseTypeId,
        roleKey: ctx.actor.roleKey,
        branchId: ctx.actor.branchId,
      });
      return waiting.ok ? Ok(waiting.value.map(toSummaryView)) : waiting;
    },
  });
}

export async function getCase(input: unknown): Promise<CaseDetailView> {
  return executeSessionServerFunction({
    name: "cases.detail",
    access: { kind: "permission", permission: "case:work" },
    parse: () =>
      parseObject(input, validationFail, (r) => ({
        caseId: r.id("caseId", CaseId),
      })),
    execute: async (ctx, { caseId }) => {
      const { cases } = getApplication();
      const [found, branches, roleNames] = await Promise.all([
        cases.read({
          caseId,
          actorUserId: ctx.actor.userId,
          roleKey: ctx.actor.roleKey,
          branchId: ctx.actor.branchId,
          viewAll: hasPermission(ctx.actor, "case:view:all"),
          canReassign: hasPermission(ctx.actor, "case:reassign"),
        }),
        cases.branches(),
        cases.roleNames(),
      ]);
      return found.ok
        ? Ok(toDetailView(found.value, branches, roleNames))
        : found;
    },
  });
}
