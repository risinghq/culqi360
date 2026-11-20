import { expectOk } from "@tests/support/_core/assertions";
import { withMerchantDefaults } from "@tests/support/database/workflow-seed";
import { operationAt } from "@tests/support/operation";
import { beforeAll, describe, expect, test } from "vitest";

import { RECORD_IMPORT_BATCH_LINES } from "~/contracts/records/imports";
import type { UserId } from "~/domain/ids";
import type { WorkflowActor } from "~/server/workflow/actor";
import { loadWorkflowActor } from "~/server/workflow/load-actor";
import type { TableBody } from "~/shared/table";

import { BENCH_NOW } from "../_shared/constants";
import {
  benchRuc,
  COMPANIES,
  createCampaignHost,
  type CampaignHost,
} from "../_shared/volume";

const STATUS_COLUMNS = [
  "documento_a_consultar",
  "resultado",
  "identificador_interno",
  "nro._linea",
];
const PRIORITY_COLUMNS = [
  "documento_a_consultar",
  "segmento",
  "prioridad",
  "evaluacion",
  "identificador_interno",
  "nro._linea",
];

// One records batch on its heaviest path: every line answers another
// executive's inquiry and reviews a lead in review. The status file goes
// first, so the priority batch completes each review and moves the lead out
// of QUALIFYING. Each batch is one transaction on the workspace's Durable
// Object.
describe("records imports", () => {
  let volume: CampaignHost;
  let backOffice: UserId;
  let registrar: WorkflowActor;
  let inquirer: WorkflowActor;
  let nextRuc = COMPANIES * 10;

  async function actor(userId: UserId): Promise<WorkflowActor> {
    const { db } = await volume.host.stores.workspace(volume.workspaceId);
    const loaded = await loadWorkflowActor(db, userId);
    if (!loaded) {
      throw new Error("bench_actor_missing");
    }
    return loaded;
  }

  // Fresh leads in review, each with a pending inquiry from another
  // executive.
  async function leadsInReview(count: number): Promise<string[]> {
    const operation = operationAt(BENCH_NOW);
    const rucs = Array.from({ length: count }, () => benchRuc(nextRuc++));
    for (const ruc of rucs) {
      // eslint-disable-next-line no-await-in-loop
      expectOk(
        await volume.app.workflow.commands.createInquiry(
          { ruc, actor: inquirer },
          operation,
        ),
      );
      // eslint-disable-next-line no-await-in-loop
      expectOk(
        await volume.app.workflow.commands.registerLead(
          {
            actor: registrar,
            ruc,
            lineOfBusiness: "Retail",
            ...withMerchantDefaults(undefined),
          },
          operation,
        ),
      );
    }
    return rucs;
  }

  function importBatch(table: TableBody) {
    return volume.app.recordImports.importTable(
      {
        actorId: backOffice,
        importType:
          table.columns === STATUS_COLUMNS
            ? "import_status"
            : "import_prioridad",
        table,
      },
      operationAt(BENCH_NOW),
    );
  }

  beforeAll(async () => {
    volume = await createCampaignHost();
    backOffice = volume.admin.id;
    const [first, second] = volume.executives;
    if (!first || !second) {
      throw new Error("bench_host_has_no_executive");
    }
    registrar = await actor(first.id);
    inquirer = await actor(second.id);
  });

  test("apply a records batch that completes reviews", async ({
    bench: run,
  }) => {
    let priorities: TableBody = { columns: PRIORITY_COLUMNS, lines: [] };
    const result = await run(
      "apply a records batch that completes reviews",
      {
        async beforeEach() {
          const rucs = await leadsInReview(RECORD_IMPORT_BATCH_LINES);
          const statuses: TableBody = {
            columns: STATUS_COLUMNS,
            lines: rucs.map((ruc, index) => ({
              line: index + 2,
              cells: [ruc, "DISPONIBLE", String(index), String(index)],
            })),
          };
          const answered = await importBatch(statuses);
          if (answered.applied !== rucs.length) {
            throw new Error(`status batch: ${JSON.stringify(answered)}`);
          }
          priorities = {
            columns: PRIORITY_COLUMNS,
            lines: rucs.map((ruc, index) => ({
              line: index + 2,
              cells: [ruc, "A", "P1", "OK", String(index), String(index)],
            })),
          };
        },
      },
      async () => {
        const reviewed = await importBatch(priorities);
        if (reviewed.applied !== priorities.lines.length) {
          throw new Error(`priority batch: ${JSON.stringify(reviewed)}`);
        }
      },
    ).run({ iterations: 10, time: 0, warmup: false });
    expect(result.state).toBe("completed");
  });
});
