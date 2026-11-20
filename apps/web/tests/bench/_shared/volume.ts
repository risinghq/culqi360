import { expectOk } from "@tests/support/_core/assertions";
import { operationAt } from "@tests/support/operation";

import { hydrateRuc } from "~/domain/identity/document";
import { ActivityId, type CampaignId, type CaseTypeId } from "~/domain/ids";
import type { CaseTypeDefinition } from "~/server/cases/domain/definition";
import type { WorkspaceApplication } from "~/server/composition/application";
import { insertBatches } from "~/server/platform/database/batches";
import type { TableBody } from "~/shared/table";

import { benchDate, BENCH_NOW } from "./constants";
import { createBenchHost, type BenchHost } from "./host";

// A workspace a few months into use, sized so the heaviest reads and writes
// meet the row counts they meet in production.
export const COMPANIES = 10_000;
export const CASES = 2_000;
export const CALLS = 5_000;
export const SEGMENT = "A";
// BENCH_NOW falls in November 2023 in Lima.
export const BENCH_MONTH = "2023-11";

const NAMES = [
  "Lima",
  "Andina",
  "Pacífico",
  "Norte",
  "Sur",
  "Inca",
  "Cusco",
  "Arequipa",
  "Amazonía",
  "Callao",
  "Trujillo",
  "Piura",
  "Chiclayo",
];
const TRADES = [
  "Comercial",
  "Transportes",
  "Inversiones",
  "Servicios",
  "Constructora",
  "Distribuidora",
  "Agroindustrias",
  "Textil",
  "Minera",
  "Farmacéutica",
  "Logística",
];
const FORMS = ["S.A.C.", "S.A.", "E.I.R.L.", "S.R.L."];

export function benchRuc(index: number): string {
  return `20${String(index).padStart(9, "0")}`;
}

function legalName(index: number): string {
  return `${TRADES[index % TRADES.length]} ${NAMES[(index * 7) % NAMES.length]} ${index} ${FORMS[index % FORMS.length]}`;
}

// A campaign table as the browser sends it: the RUC, the legal name, the
// pool column and the facts an executive reads before calling. Half the rows
// go to segment A, half to B.
export function campaignTable(from: number, count: number): TableBody {
  const lines = Array.from({ length: count }, (_, offset) => {
    const index = from + offset;
    return {
      line: offset + 2,
      cells: [
        benchRuc(index),
        legalName(index),
        index % 2 === 0 ? SEGMENT : "B",
        NAMES[index % NAMES.length] ?? "",
        String((index % 97) * 113),
      ],
    };
  });
  return {
    columns: ["ruc", "razon_social", "origen", "ciudad", "deuda_soles"],
    lines,
  };
}

export const BENCH_CASE_TYPE: CaseTypeDefinition = {
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
      key: "monto",
      stageKey: "registro",
      label: "Monto",
      kind: "number",
      choices: null,
      required: false,
    },
  ],
};

export interface CampaignHost extends BenchHost {
  app: WorkspaceApplication;
  campaignId: CampaignId;
}

export interface VolumeHost extends CampaignHost {
  caseTypeId: CaseTypeId;
}

// The bench host with COMPANIES companies imported as one campaign and every
// executive but the first holding a batch of segment A.
export async function createCampaignHost(): Promise<CampaignHost> {
  const bench = await createBenchHost();
  const app = await bench.host.workspace(bench.workspaceId);
  const operation = operationAt(BENCH_NOW);

  const { campaignId } = expectOk(
    await app.campaigns.importTable(
      {
        campaignName: "Base",
        segmentColumn: "origen",
        table: campaignTable(0, COMPANIES),
      },
      operation,
    ),
  );
  for (const executive of bench.executives.slice(1)) {
    // eslint-disable-next-line no-await-in-loop
    expectOk(
      await app.campaigns.draw(
        { actorUserId: executive.id, campaignId, segment: SEGMENT },
        operation,
      ),
    );
  }
  return { ...bench, app, campaignId };
}

// The campaign host with CASES cases opened round-robin by the executives,
// and CALLS calls logged across the month.
export async function createVolumeHost(): Promise<VolumeHost> {
  const campaign = await createCampaignHost();
  const { app } = campaign;

  expectOk(
    await app.cases.defineCaseType(BENCH_CASE_TYPE, operationAt(BENCH_NOW)),
  );
  const [caseType] = await app.cases.types("executive");
  if (!caseType) {
    throw new Error("bench_case_type_missing");
  }
  for (let index = 0; index < CASES; index += 1) {
    const executive = campaign.executives[index % campaign.executives.length];
    if (!executive) {
      throw new Error("bench_host_has_no_executive");
    }
    // eslint-disable-next-line no-await-in-loop
    expectOk(
      await app.cases.open(
        {
          actorUserId: executive.id,
          actorRoleKey: "executive",
          actorBranchId: campaign.branchId,
          caseTypeKey: BENCH_CASE_TYPE.key,
          ruc: hydrateRuc(benchRuc(index)),
          values: { plan: "FIBRA 300", monto: 100 + (index % 50) },
        },
        operationAt(benchDate(-index * 60_000)),
      ),
    );
  }

  await logCalls(campaign);

  return { ...campaign, caseTypeId: caseType.id };
}

// Calls have no bulk path in the app: the extension and the call screen log
// them one at a time. The seed writes them directly.
async function logCalls(bench: BenchHost) {
  const { db } = await bench.host.stores.workspace(bench.workspaceId);
  const organizations = await db
    .selectFrom("organizations")
    .select("id")
    .orderBy("seq")
    .limit(CALLS)
    .execute();
  const monthStart = Date.parse("2023-11-01T13:00:00.000Z");
  const calls = organizations.map((organization, index) => {
    const executive = bench.executives[index % bench.executives.length];
    if (!executive) {
      throw new Error("bench_host_has_no_executive");
    }
    const startedAt = new Date(monthStart + index * 8 * 60_000);
    return {
      id: ActivityId.mint(),
      channel: "call" as const,
      user_id: executive.id,
      branch_id: bench.branchId,
      organization_id: organization.id,
      source: "manual" as const,
      started_at: startedAt,
      ended_at: new Date(startedAt.getTime() + 75_000),
      duration_seconds: 75,
    };
  });
  for (const batch of insertBatches(calls)) {
    // eslint-disable-next-line no-await-in-loop
    await db.insertInto("activities").values(batch).execute();
  }
}
