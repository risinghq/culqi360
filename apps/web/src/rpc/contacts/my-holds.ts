import { query } from "@solidjs/router";

import { getMyContactHolds } from "~/server/contacts/ui/queries";

export const myContactHoldsQuery = query(async () => {
  "use server";
  return getMyContactHolds();
}, "contact-holds.mine");
