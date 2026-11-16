import type { Role } from "~/domain/auth/access/rbac";
import { fail, invalid, type DomainError } from "~/domain/errors";
import { Err, Ok, type Result } from "~/shared/result";

import {
  openingStage,
  stageGates,
  type CaseFieldDefinition,
  type CaseStageDefinition,
  type CaseTypeDefinition,
} from "./definition";

export type CaseValue = string | number | null;
export type CaseValues = Readonly<Record<string, CaseValue>>;

// The case as the rules see it: field values, and the status each stage holds.
export type CaseProgress = {
  values: CaseValues;
  statuses: Readonly<Record<string, string>>;
};

export type StageWrite = {
  stageKey: string;
  actorRole: Role;
  actorOwnsCase: boolean;
  values: Readonly<Record<string, unknown>>;
  status?: string;
};

export function decideCaseOpening(
  definition: CaseTypeDefinition,
  input: { actorRole: Role; values: Readonly<Record<string, unknown>> },
): Result<CaseProgress, DomainError> {
  const stage = openingStage(definition);
  const fresh: CaseProgress = {
    values: {},
    statuses: Object.fromEntries(
      definition.stages.map((each) => [each.key, each.initialStatus]),
    ),
  };
  const opened = decideStageWrite(definition, fresh, {
    stageKey: stage.key,
    actorRole: input.actorRole,
    actorOwnsCase: true,
    values: input.values,
  });
  if (!opened.ok) {
    return opened;
  }
  // The opening stage files the case, so it is complete from the start.
  const missing = missingRequired(definition, stage, opened.value.values);
  if (missing.length > 0) {
    return Err(invalid({ code: "case_fields_missing", details: { missing } }));
  }
  return opened;
}

// Whether the actor may write the stage now, or why not.
export type StageAccess = "writable" | "not_owned" | "not_open" | "locked";

// The opening stage belongs to the case's owner. Another user with the same
// role owns cases of their own, not this one.
export function stageAccess(
  definition: CaseTypeDefinition,
  progress: CaseProgress,
  stage: CaseStageDefinition,
  actor: { role: Role; ownsCase: boolean },
): StageAccess {
  if (actor.role !== stage.ownerRole) {
    return "not_owned";
  }
  if (stage.gate === null && !actor.ownsCase) {
    return "not_owned";
  }
  if (!isStageOpen(definition, stage, progress)) {
    return "not_open";
  }
  if (isStageLocked(definition, stage, progress)) {
    return "locked";
  }
  return "writable";
}

const ACCESS_ERRORS = {
  not_owned: "case_stage_not_owned",
  not_open: "case_stage_not_open",
  locked: "case_stage_locked",
} as const;

export function decideStageWrite(
  definition: CaseTypeDefinition,
  progress: CaseProgress,
  write: StageWrite,
): Result<CaseProgress, DomainError> {
  const stage = definition.stages.find((each) => each.key === write.stageKey);
  if (!stage) {
    return Err(fail("case_stage_not_found"));
  }
  const access = stageAccess(definition, progress, stage, {
    role: write.actorRole,
    ownsCase: write.actorOwnsCase,
  });
  if (access !== "writable") {
    return Err(fail(ACCESS_ERRORS[access]));
  }

  const parsed = parseStageValues(definition, stage, write.values);
  if (!parsed.ok) {
    return parsed;
  }
  const values = { ...progress.values, ...parsed.value };

  const status = write.status ?? progress.statuses[stage.key];
  if (status === undefined || !stage.statuses.includes(status)) {
    return Err(invalid({ code: "case_status_invalid", details: { status } }));
  }
  if (status !== stage.initialStatus) {
    const missing = missingRequired(definition, stage, values);
    if (missing.length > 0) {
      return Err(
        invalid({ code: "case_fields_missing", details: { missing } }),
      );
    }
  }

  return Ok({
    values,
    statuses: { ...progress.statuses, [stage.key]: status },
  });
}

function isStageOpen(
  definition: CaseTypeDefinition,
  stage: CaseStageDefinition,
  progress: CaseProgress,
): boolean {
  return stageGates(definition, stage).every((gate) => {
    const gateStatus = progress.statuses[gate.stageKey];
    return gateStatus !== undefined && gate.statuses.includes(gateStatus);
  });
}

// A stage freezes once a stage gated on it has acted, so a decision is never
// made on values that change underneath it.
function isStageLocked(
  definition: CaseTypeDefinition,
  stage: CaseStageDefinition,
  progress: CaseProgress,
): boolean {
  return definition.stages.some(
    (later) =>
      later.gate?.stageKey === stage.key &&
      progress.statuses[later.key] !== later.initialStatus,
  );
}

function parseStageValues(
  definition: CaseTypeDefinition,
  stage: CaseStageDefinition,
  input: Readonly<Record<string, unknown>>,
): Result<Record<string, CaseValue>, DomainError> {
  const parsed: Record<string, CaseValue> = {};
  const rejected: string[] = [];

  for (const [key, raw] of Object.entries(input)) {
    const field = definition.fields.find((each) => each.key === key);
    if (!field || field.stageKey !== stage.key) {
      rejected.push(key);
      continue;
    }
    const value = parseFieldValue(field, raw);
    if (value === undefined) {
      rejected.push(key);
      continue;
    }
    parsed[key] = value;
  }

  if (rejected.length > 0) {
    return Err(invalid({ code: "case_fields_invalid", details: { rejected } }));
  }
  return Ok(parsed);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// The round trip rejects a day the month does not have, which Date rolls over.
function isCalendarDate(raw: string): boolean {
  if (!ISO_DATE.test(raw)) {
    return false;
  }
  const date = new Date(`${raw}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(raw);
}

// Returns undefined for a value the field cannot hold. An empty value clears
// the field.
function parseFieldValue(
  field: CaseFieldDefinition,
  raw: unknown,
): CaseValue | undefined {
  if (raw === null || raw === "") {
    return null;
  }
  switch (field.kind) {
    case "number":
      return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
    case "text":
      return typeof raw === "string" ? raw.trim() || null : undefined;
    case "date":
      return typeof raw === "string" && isCalendarDate(raw) ? raw : undefined;
    case "choice":
      return typeof raw === "string" && field.choices?.includes(raw)
        ? raw
        : undefined;
  }
}

function missingRequired(
  definition: CaseTypeDefinition,
  stage: CaseStageDefinition,
  values: CaseValues,
): string[] {
  return definition.fields
    .filter(
      (field) =>
        field.stageKey === stage.key &&
        field.required &&
        (values[field.key] ?? null) === null,
    )
    .map((field) => field.key);
}
