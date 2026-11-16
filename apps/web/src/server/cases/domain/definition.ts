import type { Role } from "~/domain/auth/access/rbac";
import { invalid, type DomainError } from "~/domain/errors";
import { Err, Ok, type Result } from "~/shared/result";

export type CaseFieldKind = "text" | "number" | "date" | "choice";

export type CaseFieldDefinition = {
  key: string;
  stageKey: string;
  label: string;
  kind: CaseFieldKind;
  choices: readonly string[] | null;
  required: boolean;
  // Later stages that may also write the field: Entel's validador corrects the
  // line count the executive filed. The field stays in its own stage for
  // display and for the required check of that stage.
  correctedBy?: readonly string[];
};

// A stage opens when the gate stage holds one of the listed statuses.
export type CaseStageGate = {
  stageKey: string;
  statuses: readonly string[];
};

export type CaseStageDefinition = {
  key: string;
  name: string;
  ownerRole: Role;
  statuses: readonly string[];
  initialStatus: string;
  gate: CaseStageGate | null;
};

export type CaseTypeDefinition = {
  key: string;
  name: string;
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
  }

  // The correction check walks gate chains, which are only sound once the
  // stages above have passed.
  if (problems.length === 0) {
    problems.push(...correctionProblems(definition));
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
