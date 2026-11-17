import type { OutcomeView } from "~/contracts/activities/views";
import { getApplication } from "~/server/composition/application";
import { executeSessionServerFunction } from "~/server/platform/action";
import { Ok } from "~/shared/result";

// Every member records results, so any session may read the list.
export function listOutcomes(): Promise<OutcomeView[]> {
  return executeSessionServerFunction({
    name: "activities.outcomes.list",
    access: { kind: "session" },
    execute: async () => Ok(await getApplication().activities.listOutcomes()),
  });
}
