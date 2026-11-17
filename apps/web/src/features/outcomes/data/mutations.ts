import { action } from "@solidjs/router";
import { respond } from "@solidjs/web";

import {
  archiveOutcome,
  createOutcome,
  updateOutcome,
} from "~/rpc/activities/actions";
import { outcomesQuery } from "~/rpc/activities/queries";

export type OutcomeFlags = {
  label: string;
  contacted: boolean;
  negotiated: boolean;
  callback: boolean;
};

const revalidate = [outcomesQuery.key];

export const createOutcomeMutation = action(
  async (input: OutcomeFlags & { channel: "call" | "visit" }) =>
    respond(await createOutcome(input), { revalidate }),
  "createOutcome",
);

export const updateOutcomeMutation = action(
  async (input: OutcomeFlags & { id: string }) =>
    respond(await updateOutcome(input), { revalidate }),
  "updateOutcome",
);

export const archiveOutcomeMutation = action(
  async (id: string) => respond(await archiveOutcome(id), { revalidate }),
  "archiveOutcome",
);
