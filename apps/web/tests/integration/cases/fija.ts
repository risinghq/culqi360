import type { CaseTypeDefinition } from "~/server/cases/domain/definition";

// A two-stage process: the executive files the order, and the back office
// installs it once it is filed.
export const FIJA: CaseTypeDefinition = {
  key: "nc_fija",
  name: "Nota de cargo fija",
  stages: [
    {
      key: "registro",
      name: "Registro",
      ownerRole: "executive",
      statuses: ["REGISTRADO"],
      initialStatus: "REGISTRADO",
      gate: null,
    },
    {
      key: "back",
      name: "Back",
      ownerRole: "back_office",
      statuses: ["PENDIENTE", "INSTALADO"],
      initialStatus: "PENDIENTE",
      gate: { stageKey: "registro", statuses: ["REGISTRADO"] },
    },
  ],
  fields: [
    {
      key: "plan",
      stageKey: "registro",
      label: "Plan",
      kind: "choice",
      choices: ["FIBRA 300", "FIBRA 600"],
      required: true,
    },
    {
      key: "fecha_instalacion",
      stageKey: "back",
      label: "Instalación",
      kind: "date",
      choices: null,
      required: true,
    },
  ],
};
