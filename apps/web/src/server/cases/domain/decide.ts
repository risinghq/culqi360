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

// Who acts on a case: the key of their role, whether they hold it, and the
// branch they work in now.
export type CaseActor = {
  roleKey: string;
  holdsCase: boolean;
  branchId: string;
};

// `today` is the app's calendar date when the write happens; a field can be
// required once a date it names is old enough. `branchIds` are the workspace's
// branches, the values a branch field can hold. `fileIds` are the files a file
// field can hold: those the actor uploaded and those already on the case, so
// nobody attaches another user's upload to read it through the case.
export type StageWrite = {
  stageKey: string;
  actor: CaseActor;
  values: Readonly<Record<string, unknown>>;
  status?: string;
  today: CalendarDate;
  branchIds: ReadonlySet<string>;
  fileIds: ReadonlySet<string>;
};

export function decideCaseOpening(
  definition: CaseTypeDefinition,
  input: {
    actor: Omit<CaseActor, "holdsCase">;
    values: Readonly<Record<string, unknown>>;
    today: CalendarDate;
    branchIds: ReadonlySet<string>;
    fileIds: ReadonlySet<string>;
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
    actor: { ...input.actor, holdsCase: true },
    values: input.values,
    today: input.today,
    branchIds: input.branchIds,
    fileIds: input.fileIds,
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

// The opening stage belongs to the case's holder. Another user with the same
// role holds cases of their own, not this one.
export function stageAccess(
  definition: CaseTypeDefinition,
  progress: CaseProgress,
  stage: CaseStageDefinition,
  actor: CaseActor,
): StageAccess {
  if (actor.roleKey !== stage.ownerRole) {
    return "not_owned";
  }
  if (stage.gate === null && !actor.holdsCase) {
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
    write,
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

type KnownIds = Pick<StageWrite, "branchIds" | "fileIds">;

function parseStageValues(
  writable: readonly CaseFieldDefinition[],
  input: Readonly<Record<string, unknown>>,
  known: KnownIds,
): Result<Record<string, CaseValue>, DomainError> {
  const parsed: Record<string, CaseValue> = {};
  const rejected: string[] = [];

  for (const [key, raw] of Object.entries(input)) {
    const field = writable.find((each) => each.key === key);
    if (!field) {
      rejected.push(key);
      continue;
    }
    const value = parseFieldValue(field, raw, known);
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
  known: KnownIds,
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
      return typeof raw === "string" && known.branchIds.has(raw)
        ? raw
        : undefined;
    case "file":
      return typeof raw === "string" && known.fileIds.has(raw)
        ? raw
        : undefined;
  }
}

// The file ids the values hold, so a write can keep the files already there.
export function caseFileIds(
  definition: CaseTypeDefinition,
  values: CaseValues,
): string[] {
  return definition.fields.flatMap((field) => {
    const value = values[field.key];
    return field.kind === "file" && typeof value === "string" ? [value] : [];
  });
}

// The stages whose timeout counts: waiting in the timeout's status, open, and
// not yet ruled on by a later stage.
function countingStages(
  definition: CaseTypeDefinition,
  progress: CaseProgress,
): CaseStageDefinition[] {
  return definition.stages.filter(
    (stage) =>
      stage.timeout !== undefined &&
      progress.statuses[stage.key] === stage.timeout.whileStatus &&
      isStageOpen(definition, stage, progress) &&
      !isStageLocked(definition, stage, progress),
  );
}

export type StageDeadlines = Readonly<Record<string, Date | null>>;

const HOUR_MS = 60 * 60 * 1000;

// The due date of every timed stage after a change. A stage that keeps
// counting keeps its date, so writing values does not extend it; a stage that
// starts counting gets a fresh one; any other gets none.
export function nextDeadlines(
  definition: CaseTypeDefinition,
  before: CaseProgress | null,
  after: CaseProgress,
  current: StageDeadlines,
  at: Date,
): StageDeadlines {
  const wasCounting = new Set(
    before ? countingStages(definition, before).map((stage) => stage.key) : [],
  );
  const counting = new Set(
    countingStages(definition, after).map((stage) => stage.key),
  );
  return Object.fromEntries(
    definition.stages.flatMap((stage): [string, Date | null][] => {
      if (!stage.timeout) {
        return [];
      }
      if (!counting.has(stage.key)) {
        return [[stage.key, null]];
      }
      const kept = wasCounting.has(stage.key) ? current[stage.key] : null;
      return [
        [
          stage.key,
          kept ?? new Date(at.getTime() + stage.timeout.afterHours * HOUR_MS),
        ],
      ];
    }),
  );
}

// Moves a stage whose deadline has passed. The sweep reads due stages before
// it locks the case, so a write in between may have stopped the count.
export function decideTimeout(
  definition: CaseTypeDefinition,
  progress: CaseProgress,
  stageKey: string,
  dueAt: Date | null,
  at: Date,
): Result<CaseProgress, DomainError> {
  const stage = countingStages(definition, progress).find(
    (each) => each.key === stageKey,
  );
  if (!stage?.timeout || dueAt === null || dueAt > at) {
    return Err(fail("case_stage_not_due"));
  }
  return Ok({
    values: progress.values,
    statuses: { ...progress.statuses, [stage.key]: stage.timeout.moveTo },
  });
}

// The holder works the opening stage, so only a user of its role can hold the
// case.
export function decideReassign(
  definition: CaseTypeDefinition,
  target: { active: boolean; roleKey: string | null },
): Result<null, DomainError> {
  if (!target.active || target.roleKey !== openingStage(definition).ownerRole) {
    return Err(fail("case_holder_invalid"));
  }
  return Ok(null);
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
