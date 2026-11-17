import type {
  CaseFieldCondition,
  CaseNumberBounds,
} from "~/domain/cases/field-rules";
import { invalid, type DomainError } from "~/domain/errors";
import { Err, Ok, type Result } from "~/shared/result";

// A branch field holds the id of one of the workspace's branches, so its
// choices are the branches at write time, not a list in the definition. A file
// field holds the id of a case_file asset.
export type CaseFieldKind =
  | "text"
  | "number"
  | "date"
  | "choice"
  | "branch"
  | "file";

export type CaseFieldDefinition = {
  key: string;
  stageKey: string;
  label: string;
  kind: CaseFieldKind;
  choices: readonly string[] | null;
  required: boolean;
  // Required only when the condition holds. A field with `required` set needs
  // no condition.
  requiredWhen?: CaseFieldCondition;
  // Number fields only.
  bounds?: CaseNumberBounds;
  // Later stages that may also write the field: Entel's validador corrects the
  // line count the executive filed. The field stays in its own stage for
  // display and for the required check of that stage.
  correctedBy?: readonly string[];
  // The field's stage may still write it after the stage locks, while a later
  // stage holds one of the statuses: Entel's executive updates a quiebre's
  // contacts while the validador is PROCESANDO.
  amendableWhile?: CaseStageGate;
};

// A stage opens when the gate stage holds one of the listed statuses.
export type CaseStageGate = {
  stageKey: string;
  statuses: readonly string[];
};

export type CaseStageDefinition = {
  key: string;
  name: string;
  // The key of a workspace role. Two roles of one kind own different stages:
  // Entel's validador is a supervisor that only validates.
  ownerRole: string;
  statuses: readonly string[];
  initialStatus: string;
  gate: CaseStageGate | null;
  // A branch field from an earlier stage. Only a user working in that branch
  // writes the stage: Entel's validador rules on the quiebres of their tienda.
  branchField?: string;
  timeout?: CaseStageTimeout;
};

// A stage left in one status for too long moves to another on its own: a
// pricing reservation lapses when nobody answers it. A module type may leave
// out afterHours and pass each deadline with the write, because Culqi's
// reservation lasts the validity days of the workspace's pricing policy.
export type CaseStageTimeout = {
  whileStatus: string;
  afterHours?: number;
  moveTo: string;
};

export type CaseTypeDefinition = {
  key: string;
  name: string;
  // The workspace module whose code writes every stage of the type, as
  // Culqi's lead is written by the culqi module. No form writes such a type,
  // and the case screens do not show it.
  module?: string;
  stages: readonly CaseStageDefinition[];
  fields: readonly CaseFieldDefinition[];
};

// Checks the definition once, before it is stored, so the decisions can trust
// it. Stages are in process order and a gate names an earlier stage, so the
// process has one opening stage and no cycle.
export function checkCaseTypeDefinition(
  definition: CaseTypeDefinition,
): Result<CaseTypeDefinition, DomainError> {
  const problems: string[] = [];
  const seenStages = new Map<string, CaseStageDefinition>();

  for (const stage of definition.stages) {
    if (seenStages.has(stage.key)) {
      problems.push(`stage ${stage.key} is defined twice`);
    }
    if (!stage.statuses.includes(stage.initialStatus)) {
      problems.push(`stage ${stage.key} starts in an unknown status`);
    }
    if (stage.gate) {
      const gateStage = seenStages.get(stage.gate.stageKey);
      if (!gateStage) {
        problems.push(
          `stage ${stage.key} is gated on a later or unknown stage`,
        );
      } else if (
        stage.gate.statuses.some(
          (status) => !gateStage.statuses.includes(status),
        )
      ) {
        problems.push(`stage ${stage.key} is gated on an unknown status`);
      }
    }
    problems.push(...timeoutProblems(stage, definition.module !== undefined));
    seenStages.set(stage.key, stage);
  }

  const openingStages = definition.stages.filter((stage) => !stage.gate);
  if (openingStages.length !== 1) {
    problems.push("a case type needs exactly one stage without a gate");
  }

  const seenFields = new Set<string>();
  for (const field of definition.fields) {
    if (seenFields.has(field.key)) {
      problems.push(`field ${field.key} is defined twice`);
    }
    seenFields.add(field.key);
    if (!seenStages.has(field.stageKey)) {
      problems.push(`field ${field.key} belongs to an unknown stage`);
    }
    if (field.kind === "choice" && !field.choices?.length) {
      problems.push(`choice field ${field.key} has no choices`);
    }
    if (field.kind !== "choice" && field.choices?.length) {
      problems.push(`field ${field.key} lists choices but is not a choice`);
    }
    problems.push(...boundsProblems(field));
  }

  // These checks look fields and stages up, which is only sound once the
  // checks above have passed.
  if (problems.length === 0) {
    problems.push(...correctionProblems(definition));
    problems.push(...conditionProblems(definition));
    problems.push(...amendProblems(definition));
    problems.push(...branchProblems(definition));
  }

  if (problems.length > 0) {
    return Err(invalid({ code: "case_type_invalid", details: { problems } }));
  }
  return Ok(definition);
}

// A correcting stage must come after the field's stage on its gate chain, so
// it writes only once the field's stage has handed the case on.
function correctionProblems(definition: CaseTypeDefinition): string[] {
  const problems: string[] = [];
  for (const field of definition.fields) {
    for (const stageKey of field.correctedBy ?? []) {
      const stage = definition.stages.find((each) => each.key === stageKey);
      const follows = stage
        ? stageGates(definition, stage).some(
            (gate) => gate.stageKey === field.stageKey,
          )
        : false;
      if (!follows) {
        problems.push(
          `field ${field.key} is corrected by a stage that does not follow its own`,
        );
      }
    }
  }
  return problems;
}

// A field stays amendable only while a stage that follows its own works the
// case, because only such a stage locks it.
function amendProblems(definition: CaseTypeDefinition): string[] {
  const problems: string[] = [];
  for (const field of definition.fields) {
    const amendable = field.amendableWhile;
    if (!amendable) {
      continue;
    }
    const stage = definition.stages.find(
      (each) => each.key === amendable.stageKey,
    );
    if (
      !stage ||
      !stageGates(definition, stage).some(
        (gate) => gate.stageKey === field.stageKey,
      )
    ) {
      problems.push(
        `field ${field.key} stays amendable on a stage that does not follow its own`,
      );
    } else if (
      amendable.statuses.some((status) => !stage.statuses.includes(status))
    ) {
      problems.push(`field ${field.key} stays amendable at an unknown status`);
    }
  }
  return problems;
}

// The branch is settled before the scoped stage works the case, so the field
// belongs to a stage on its gate chain.
function branchProblems(definition: CaseTypeDefinition): string[] {
  return definition.stages.flatMap((stage) => {
    if (stage.branchField === undefined) {
      return [];
    }
    const field = definition.fields.find(
      (each) => each.key === stage.branchField,
    );
    const earlier = stageGates(definition, stage).some(
      (gate) => gate.stageKey === field?.stageKey,
    );
    return field?.kind === "branch" && earlier
      ? []
      : [
          `stage ${stage.key} is scoped by a field that is not an earlier branch`,
        ];
  });
}

function timeoutProblems(
  stage: CaseStageDefinition,
  moduleOwned: boolean,
): string[] {
  const timeout = stage.timeout;
  if (!timeout) {
    return [];
  }
  const problems: string[] = [];
  if (
    !stage.statuses.includes(timeout.whileStatus) ||
    !stage.statuses.includes(timeout.moveTo)
  ) {
    problems.push(`stage ${stage.key} times out on an unknown status`);
  }
  if (timeout.whileStatus === timeout.moveTo) {
    problems.push(`stage ${stage.key} times out into the status it waits in`);
  }
  const hours = timeout.afterHours;
  if (hours === undefined) {
    if (!moduleOwned) {
      problems.push(`stage ${stage.key} times out after no number of hours`);
    }
  } else if (!Number.isInteger(hours) || hours < 1) {
    problems.push(`stage ${stage.key} times out after a bad number of hours`);
  }
  return problems;
}

function boundsProblems(field: CaseFieldDefinition): string[] {
  if (!field.bounds) {
    return [];
  }
  if (field.kind !== "number") {
    return [`field ${field.key} has bounds but is not a number`];
  }
  const { min, max } = field.bounds;
  if (min !== undefined && max !== undefined && min > max) {
    return [`field ${field.key} has a minimum above its maximum`];
  }
  return [];
}

function conditionProblems(definition: CaseTypeDefinition): string[] {
  const problems: string[] = [];
  for (const field of definition.fields) {
    const condition = field.requiredWhen;
    if (!condition) {
      continue;
    }
    if (field.required) {
      problems.push(`field ${field.key} is required and also conditional`);
    }
    if (condition.kind === "status") {
      const stage = definition.stages.find(
        (each) => each.key === field.stageKey,
      );
      if (
        condition.statuses.some((status) => !stage?.statuses.includes(status))
      ) {
        problems.push(`field ${field.key} is required at an unknown status`);
      }
      continue;
    }
    const source = definition.fields.find(
      (each) => each.key === condition.fieldKey,
    );
    if (!source) {
      problems.push(`field ${field.key} depends on an unknown field`);
    } else if (condition.kind === "age" && source.kind !== "date") {
      problems.push(
        `field ${field.key} counts age from a field that is not a date`,
      );
    } else if (
      condition.kind === "value" &&
      source.kind === "choice" &&
      condition.values.some((value) => !source.choices?.includes(value))
    ) {
      problems.push(
        `field ${field.key} depends on a value its source cannot hold`,
      );
    }
    if (
      condition.kind === "age" &&
      (!Number.isInteger(condition.days) || condition.days < 1)
    ) {
      problems.push(`field ${field.key} counts age in a bad number of days`);
    }
  }
  return problems;
}

// The fields a stage writes: its own, then the earlier ones it corrects.
export function writableFields(
  definition: CaseTypeDefinition,
  stageKey: string,
): CaseFieldDefinition[] {
  return [
    ...definition.fields.filter((field) => field.stageKey === stageKey),
    ...definition.fields.filter((field) =>
      field.correctedBy?.includes(stageKey),
    ),
  ];
}

// The gates between a stage and the opening stage, its own first. A stage is
// open only when every one holds, so a gate status that is also the gate
// stage's initial status cannot open the stage before the gate stage opens.
export function stageGates(
  definition: CaseTypeDefinition,
  stage: CaseStageDefinition,
): CaseStageGate[] {
  const gates: CaseStageGate[] = [];
  let gate = stage.gate;
  while (gate) {
    gates.push(gate);
    const gateKey: string = gate.stageKey;
    gate = definition.stages.find((each) => each.key === gateKey)?.gate ?? null;
  }
  return gates;
}

export function openingStage(
  definition: CaseTypeDefinition,
): CaseStageDefinition {
  const stage = definition.stages.find((candidate) => !candidate.gate);
  if (!stage) {
    throw new Error(`case type ${definition.key} has no opening stage`);
  }
  return stage;
}
