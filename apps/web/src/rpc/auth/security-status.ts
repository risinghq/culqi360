import { query } from "@solidjs/router";

import { getSecurityStatus } from "~/server/auth/ui/security-status";

export const securityStatusQuery = query(async () => {
  "use server";
  return getSecurityStatus();
}, "auth.security.status");
