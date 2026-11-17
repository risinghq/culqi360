import { query } from "@solidjs/router";

import { listOutcomes } from "~/server/activities/ui/queries";

export const outcomesQuery = query(async () => {
  "use server";
  return listOutcomes();
}, "activities.outcomes");
