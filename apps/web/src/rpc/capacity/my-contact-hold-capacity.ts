import { query } from "@solidjs/router";

import { getMyContactHoldCapacity } from "~/server/contacts/ui/queries";

export const myContactHoldCapacityQuery = query(async () => {
  "use server";
  return getMyContactHoldCapacity();
}, "capacity.my-contact-hold");
