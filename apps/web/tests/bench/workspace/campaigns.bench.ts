import { operationAt } from "@tests/support/operation";
import { beforeAll, describe, expect, test } from "vitest";

import { CAMPAIGN_IMPORT_BATCH_LINES } from "~/contracts/campaigns/imports";
import { isErr } from "~/shared/result";
import type { TableBody } from "~/shared/table";

import { BENCH_NOW } from "../_shared/constants";
import {
  campaignTable,
  COMPANIES,
  createCampaignHost,
  SEGMENT,
  type CampaignHost,
} from "../_shared/volume";

const IMPORT_ROWS = CAMPAIGN_IMPORT_BATCH_LINES;

// The campaign writes: drawing a batch walks the segment's pool past every
// record other executives hold, and an import upserts one batch of the lines
// the browser sends, which must fit one Worker invocation's CPU budget.
describe("campaigns", () => {
  let volume: CampaignHost;
  let nextImport = 0;

  function executive() {
    const [first] = volume.executives;
    if (!first) {
      throw new Error("bench_host_has_no_executive");
    }
    return first;
  }

  beforeAll(async () => {
    volume = await createCampaignHost();
  });

  test("draw a batch past held records", async ({ bench: run }) => {
    const operation = operationAt(BENCH_NOW);
    const command = {
      actorUserId: executive().id,
      campaignId: volume.campaignId,
    };
    const result = await run(
      "draw a batch past held records",
      {
        async beforeEach() {
          const released = await volume.app.campaigns.release(
            command,
            operation,
          );
          if (isErr(released)) {
            throw new Error(`release failed: ${released.error.code}`);
          }
        },
      },
      async () => {
        const drawn = await volume.app.campaigns.draw(
          { ...command, segment: SEGMENT },
          operation,
        );
        if (isErr(drawn)) {
          throw new Error(`draw failed: ${drawn.error.code}`);
        }
      },
    ).run();
    expect(result.state).toBe("completed");
  });

  test("import a campaign batch of new companies", async ({ bench: run }) => {
    let table: TableBody = { columns: [], lines: [] };
    const result = await run(
      "import a campaign batch of new companies",
      {
        beforeEach() {
          nextImport += 1;
          table = campaignTable(
            COMPANIES + nextImport * IMPORT_ROWS,
            IMPORT_ROWS,
          );
        },
      },
      async () => {
        const imported = await volume.app.campaigns.importTable(
          {
            campaignName: `Import ${nextImport}`,
            segmentColumn: "origen",
            table,
          },
          operationAt(BENCH_NOW),
        );
        if (isErr(imported) || imported.value.imported !== IMPORT_ROWS) {
          throw new Error(`unexpected import: ${JSON.stringify(imported)}`);
        }
      },
    ).run();
    expect(result.state).toBe("completed");
  });
});
