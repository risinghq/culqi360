import type { Kysely } from "kysely";

import { createUserTotpFactorsRepo } from "~/server/auth/repos-user-totp-factors";
import { createUserChannelAddressRepo } from "~/server/notifications/repos/user-channel-address";
import type { Database } from "~/server/platform/database/types";
import { createPasskeysRepo } from "~/server/users/repos-passkeys";
import { createUsersRepo } from "~/server/users/repos-users";

export function createAuthSessionReadContext(executor: Kysely<Database>) {
  return {
    repos: {
      users: createUsersRepo(executor),
      passkeys: createPasskeysRepo(executor),
      userTotpFactors: createUserTotpFactorsRepo(executor),
      userChannelAddresses: createUserChannelAddressRepo(executor),
    },
  };
}

export type AuthSessionReadContext = ReturnType<
  typeof createAuthSessionReadContext
>;
