import {
  type LeadPriority,
  type LeadStatus,
} from "~/contracts/workflow/vocabulary";

export type ImportRowInput =
  | {
      row: number;
      ruc: string;
      type: "import_status";
      status: LeadStatus;
    }
  | {
      row: number;
      ruc: string;
      type: "import_prioridad";
      priority: LeadPriority;
    };
