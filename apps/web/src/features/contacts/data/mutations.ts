import { action } from "@solidjs/router";
import { respond } from "@solidjs/web";

import { myContactHoldCapacityQuery } from "~/rpc/capacity/my-contact-hold-capacity";
import { completeContactHoldCall } from "~/rpc/contacts/interactions";
import { myContactHoldsQuery } from "~/rpc/contacts/my-holds";

export const completeContactHoldCallMutation = action(
  async (input: {
    holdId: string;
    contactId: string;
    outcomeId: string;
    notes: string;
  }) =>
    respond(await completeContactHoldCall(input), {
      revalidate: [myContactHoldsQuery.key, myContactHoldCapacityQuery.key],
    }),
  "completeContactHoldCall",
);
