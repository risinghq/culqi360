import type { UserId, WorkflowLeadId } from "~/domain/ids";
import { applyRecordImport } from "~/server/records/imports/apply";
import type { ImportRowInput } from "~/server/records/imports/types";

import type { TestActorKey } from "../database/workflow-fixtures";
import { actorBy } from "../database/workflow-fixtures";
import { operationAt } from "../operation";
import type { TestRuntime } from "../runtime/app";

type ImportLeadRef = {
  id: WorkflowLeadId;
  organization: { ruc: string };
};

export function createWorkflowImporter(input: {
  runtime: TestRuntime;
  resolveActorUserId?: (actor: TestActorKey) => UserId;
}) {
  const { runtime } = input;

  function apply(payload: { actorId: UserId; rows: ImportRowInput[] }) {
    return applyRecordImport(
      { actorId: payload.actorId, validRows: payload.rows, invalidCount: 0 },
      runtime.importPorts,
      operationAt(runtime.now.get()),
    );
  }

  return {
    run(payload: {
      actor: TestActorKey;
      rows: Array<
        | {
            type: "status";
            lead: ImportLeadRef;
            status: "DISPONIBLE" | "SIN RESULTADO" | "CARTERIZADO" | "STOCK";
          }
        | {
            type: "priority";
            lead: ImportLeadRef;
            priority: "P1" | "P2" | "SIN RESULTADO";
          }
      >;
    }) {
      const actorId = input.resolveActorUserId
        ? input.resolveActorUserId(payload.actor)
        : actorBy(payload.actor).userId;
      const rows: ImportRowInput[] = payload.rows.map((row, index) => {
        const rowNo = index + 1;
        if (row.type === "status") {
          return {
            row: rowNo,
            ruc: row.lead.organization.ruc,
            type: "import_status",
            status: row.status,
          };
        }
        return {
          row: rowNo,
          ruc: row.lead.organization.ruc,
          type: "import_prioridad",
          priority: row.priority,
        };
      });
      return apply({ actorId, rows });
    },

    apply,
  };
}
