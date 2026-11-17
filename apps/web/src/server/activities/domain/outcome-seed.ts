import type { ActivityOutcomeId } from "~/domain/ids";
import type { ActivityChannel } from "~/server/platform/database/types";

// An outcome a workspace starts with or an admin adds. A null flag means the
// outcome does not say.
export type OutcomeSeed = {
  label: string;
  channel: ActivityChannel;
  contacted: boolean | null;
  negotiated: boolean | null;
  callback: boolean | null;
};

// An import keeps the ids it planned, so its activities can point at them.
export type CatalogOutcome = OutcomeSeed & { id?: ActivityOutcomeId };

// Every new workspace starts with these; its admin edits them.
export const BASELINE_OUTCOMES: readonly OutcomeSeed[] = [
  {
    label: "No contesta",
    channel: "call",
    contacted: false,
    negotiated: false,
    callback: false,
  },
  {
    label: "Volver a llamar",
    channel: "call",
    contacted: true,
    negotiated: false,
    callback: true,
  },
  {
    label: "Venta cerrada",
    channel: "call",
    contacted: true,
    negotiated: true,
    callback: false,
  },
  {
    label: "Datos inválidos",
    channel: "call",
    contacted: false,
    negotiated: false,
    callback: false,
  },
  {
    label: "Visita realizada",
    channel: "visit",
    contacted: true,
    negotiated: null,
    callback: null,
  },
];
