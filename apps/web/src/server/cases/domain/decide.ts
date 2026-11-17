import {
  isFieldRequired,
  isWithinBounds,
  type CaseValue,
  type CaseValues,
} from "~/domain/cases/field-rules";
import { fail, invalid, type DomainError } from "~/domain/errors";
import type { CalendarDate } from "~/domain/time/calendar-date";
import { Err, Ok, type Result } from "~/shared/result";

import {
  openingStage,
  stageGates,
  writableFields,
  type CaseFieldDefinition,
  type CaseStageDefinition,
  type CaseTypeDefinition,
} from "./definition";

// The case as the rules see it: field values, and the status each stage holds.
export type CaseProgress = {
  values: CaseValues;
  statuses: Readonly<Record<string, string>>;
};

// Who acts on a case: the key of their role, whether they filed it, and the
// branch they work in now.
export type CaseActor = {
  roleKey: string;
  ownsCase: boolean;
  branchId: string;
};

// `today` is the app's calendar date when the write happens; a field can be
// required once a date it names is old enough. `branchIds` are the workspace's
// branches, the values a branch field can hold.
export type StageWrite = {
  stageKey: string;
  actor: CaseActor;
  values: Readonly<Record<string, unknown>>;
  status?: string;
  today: CalendarDate;
  branchIds: ReadonlySet<string>;
};

export function decideCaseOpening(
  definition: CaseTypeDefinition,
  input: {
    actor: Omit<CaseActor, "ownsCase">;
    values: Readonly<Record<string, unknown>>;
    today: CalendarDate;
    branchIds: ReadonlySet<string>;
  },
): Result<CaseProgress, DomainError> {
  const stage = openingStage(definition);
  const fresh: CaseProgress = {
    values: {},
    statuses: Object.fromEntries(
      definition.stages.map((each) => [each.key, each.initialStatus]),
    ),
  };
  return decideStageWrite(definition, fresh, {
    stageKey: stage.key,
    actor: { ...input.actor, ownsCase: true },
    values: input.values,
    today: input.today,
    branchIds: input.branchIds,
  });
}

// Whether the actor may write the stage now, or why not. amending: the stage
// is locked, but some of its fields stay amendable. other_branch: the stage
// belongs to the actor's role in another branch.
export type StageAccess =
  | "writable"
  | "amending"
  | "not_owned"
  | "other_branch"
  | "not_open"
  | "locked";

// The opening stage belongs to the case's owner. Another user with the same
// role owns cases of their own, not this one.
export function stageAccess(
  definition: CaseTypeDefinition,
  progress: CaseProgress,
  stage: CaseStageDefinition,
  actor: CaseActor,
): StageAccess {
  if (actor.roleKey !== stage.ownerRole) {
    return "not_owned";
  }
  if (stage.gate === null && !actor.ownsCase) {
    return "not_owned";
  }
  if (
    stage.branchField !== undefined &&
    progress.values[stage.branchField] !== actor.branchId
  ) {
    return "other_branch";
  }
  if (!isStageOpen(definition, stage, progress)) {
    return "not_open";
  }
  if (isStageLocked(definition, stage, progress)) {
    return amendableFields(definition, stage, progress).length > 0
      ? "amending"
      : "locked";
  }
  return "writable";
}

// The fields a write to the stage may set now.
export function editableFields(
  definition: CaseTypeDefinition,
  stage: CaseStageDefinition,
  progress: CaseProgress,
): CaseFieldDefinition[] {
  return isStageLocked(definition, stage, progress)
    ? amendableFields(definition, stage, progress)
    : writableFields(definition, stage.key);
}

// The opening stage files the case, so it is complete from the start, and an
// amendment keeps the stage complete.
export function keepsRequired(
  stage: CaseStageDefinition,
  access: StageAccess,
): boolean {
  return stage.gate === null || access === "amending";
}

function amendableFields(
  definition: CaseTypeDefinition,
  stage: CaseStageDefinition,
  progress: CaseProgress,
): CaseFieldDefinition[] {
  return definition.fields.filter((field) => {
    const amendable = field.amendableWhile;
    if (field.stageKey !== stage.key || !amendable) {
      return false;
    }
    const status = progress.statuses[amendable.stageKey];
    return status !== undefined && amendable.statuses.includes(status);
  });
}

const ACCESS_ERRORS = {
  not_owned: "case_stage_not_owned",
  other_branch: "case_stage_not_owned",
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
  const access = stageAccess(definition, progress, stage, write.actor);
  if (access !== "writable" && access !== "amending") {
    return Err(fail(ACCESS_ERRORS[access]));
  }

  const current = progress.statuses[stage.key];
  const status = write.status ?? current;
  // An amendment changes values only; the stages after it ruled on the status.
  if (access === "amending" && status !== current) {
    return Err(fail("case_stage_locked"));
  }
  const parsed = parseStageValues(
    editableFields(definition, stage, progress),
    write.values,
    write.branchIds,
  );
  if (!parsed.ok) {
    return parsed;
  }
  if (status === undefined || !stage.statuses.includes(status)) {
    return Err(invalid({ code: "case_status_invalid", details: { status } }));
  }
  const written: CaseProgress = {
    values: { ...progress.values, ...parsed.value },
    statuses: { ...progress.statuses, [stage.key]: status },
  };
  if (status !== stage.initialStatus || keepsRequired(stage, access)) {
    const missing = missingRequired(definition, stage, written, write.today);
    if (missing.length > 0) {
      return Err(
        invalid({ code: "case_fields_missing", details: { missing } }),
      );
    }
  }

  return Ok(written);
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
  writable: readonly CaseFieldDefinition[],
  input: Readonly<Record<string, unknown>>,
  branchIds: ReadonlySet<string>,
): Result<Record<string, CaseValue>, DomainError> {
  const parsed: Record<string, CaseValue> = {};
  const rejected: string[] = [];

  for (const [key, raw] of Object.entries(input)) {
    const field = writable.find((each) => each.key === key);
    if (!field) {
      rejected.push(key);
      continue;
    }
    const value = parseFieldValue(field, raw, branchIds);
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
  branchIds: ReadonlySet<string>,
): CaseValue | undefined {
  if (raw === null || raw === "") {
    return null;
  }
  switch (field.kind) {
    case "number":
      return typeof raw === "number" &&
        Number.isFinite(raw) &&
        isWithinBounds(field.bounds ?? {}, raw)
        ? raw
        : undefined;
    case "text":
      return typeof raw === "string" ? raw.trim() || null : undefined;
    case "date":
      return typeof raw === "string" && isCalendarDate(raw) ? raw : undefined;
    case "choice":
      return typeof raw === "string" && field.choices?.includes(raw)
        ? raw
        : undefined;
    case "branch":
      return typeof raw === "string" && branchIds.has(raw) ? raw : undefined;
  }
}

function missingRequired(
  definition: CaseTypeDefinition,
  stage: CaseStageDefinition,
  progress: CaseProgress,
  today: CalendarDate,
): string[] {
  const context = { ...progress, today };
  return writableFields(definition, stage.key)
    .filter(
      (field) =>
        isFieldRequired(field, context) &&
        (progress.values[field.key] ?? null) === null,
    )
    .map((field) => field.key);
}
