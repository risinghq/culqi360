import { runCutover } from "../shared/run";
import { readCrmEntelSnapshot } from "./source";
import { planCrmEntelCutover } from "./transform";

const url = process.env.CRM_ENTEL_DATABASE_URL;
if (!url) {
  throw new Error("CRM_ENTEL_DATABASE_URL is not set");
}

await runCutover({
  defaultName: "Entel Empresas",
  plan: async (input) =>
    planCrmEntelCutover({
      snapshot: await readCrmEntelSnapshot(url),
      ...input,
    }),
});
