import type { Kysely } from "kysely";

import { createActivitiesRepo } from "~/server/activities/infrastructure/activities-repo";
import { createOutcomesRepo } from "~/server/activities/infrastructure/outcomes-repo";
import { createAuditActionPoliciesRepo } from "~/server/audit-reader/audit-policy-repo";
import { createAuthEventsRepo } from "~/server/auth/repos-auth-events";
import { createAuthThrottleRepo } from "~/server/auth/repos-auth-throttle";
import { createLoginFlowsRepo } from "~/server/auth/repos-login-flows";
import { createOAuthAccountsRepo } from "~/server/auth/repos-oauth-accounts";
import { createPasswordResetTokensRepo } from "~/server/auth/repos-password-reset";
import { createUserRecoveryCodesRepo } from "~/server/auth/repos-user-recovery-codes";
import { createUserTotpFactorsRepo } from "~/server/auth/repos-user-totp-factors";
import { createCapacityRequestsRepo } from "~/server/capacity/infrastructure/capacity-requests-repo";
import {
  createDrawPolicyDefaultsRepo,
  createDrawPolicyOverridesRepo,
  createSearchPolicyDefaultsRepo,
  createSearchPolicyOverridesRepo,
} from "~/server/capacity/infrastructure/policy-repos";
import {
  createCapacityCommitsRepo,
  createCapacityGrantsRepo,
  createCapacityReservationsRepo,
} from "~/server/capacity/infrastructure/usage-repo";
import { createCompanyRegistryRepo } from "~/server/client-search/repository";
import { createContactCadenceRepo } from "~/server/contacts/infrastructure/cadence-repo";
import { createContactHoldsRepo } from "~/server/contacts/infrastructure/hold-repo";
import { createExtensionRecordingsRepo } from "~/server/extension/recordings-repo";
import { createExtensionRuntimeRepo } from "~/server/extension/repos";
import { createIntegrationJobRepo } from "~/server/integrations/infrastructure/integration-job-repo";
import { createAppNotificationRepo } from "~/server/notifications/repos/app-notification";
import { createUserChannelAddressRepo } from "~/server/notifications/repos/user-channel-address";
import { createOrganizationRepo } from "~/server/organization/organization-repo";
import type {
  PlatformDatabase,
  RegistryDatabase,
  WorkspaceDatabase,
} from "~/server/platform/database/types";
import { createRolesRepo } from "~/server/roles/repos-roles";
import { createActionRateLimitsRepo } from "~/server/security/repos-action-rate-limits";
import { createSessionRepository } from "~/server/sessions/repos-sessions";
import { createAccountsRepo } from "~/server/users/repos-accounts";
import { createBranchesRepo } from "~/server/users/repos-branches";
import { createMembersRepo } from "~/server/users/repos-members";
import { createMembershipsRepo } from "~/server/users/repos-memberships";
import { createPasskeysRepo } from "~/server/users/repos-passkeys";
import { createTeamsRepo } from "~/server/users/repos-teams";
import { createUserInvitesRepo } from "~/server/users/repos-user-invites";
import { createWebauthnChallengesRepo } from "~/server/users/repos-webauthn-challenges";

export interface TestStores {
  platform: Kysely<PlatformDatabase>;
  registry: Kysely<RegistryDatabase>;
  // The fixture workspace.
  db: Kysely<WorkspaceDatabase>;
}

export function createTestRepositories({ platform, registry, db }: TestStores) {
  return {
    accounts: createAccountsRepo(platform),
    memberships: createMembershipsRepo(platform),
    userInvites: createUserInvitesRepo(platform),
    authEvents: createAuthEventsRepo(platform),
    loginFlows: createLoginFlowsRepo(platform),
    authThrottle: createAuthThrottleRepo(platform),
    userTotpFactors: createUserTotpFactorsRepo(platform),
    userRecoveryCodes: createUserRecoveryCodesRepo(platform),
    passkeys: createPasskeysRepo(platform),
    webauthnChallenges: createWebauthnChallengesRepo(platform),
    oauthAccounts: createOAuthAccountsRepo(platform),
    passwordResetTokens: createPasswordResetTokensRepo(platform),
    searchEnrichment: createCompanyRegistryRepo(registry),

    members: createMembersRepo(db),
    sessions: createSessionRepository(db),
    roles: createRolesRepo(db),
    actionRateLimits: createActionRateLimitsRepo(db),
    organization: createOrganizationRepo(db),
    contactHolds: createContactHoldsRepo(db),
    cadence: createContactCadenceRepo(db),
    searchPolicyDefaults: createSearchPolicyDefaultsRepo(db),
    searchPolicyOverrides: createSearchPolicyOverridesRepo(db),
    drawPolicyDefaults: createDrawPolicyDefaultsRepo(db),
    drawPolicyOverrides: createDrawPolicyOverridesRepo(db),
    searchCapacityGrants: createCapacityGrantsRepo(db, "search"),
    searchUsageReservations: createCapacityReservationsRepo(db, "search"),
    searchUsageCommits: createCapacityCommitsRepo(db, "search"),
    drawCapacityGrants: createCapacityGrantsRepo(db, "draw"),
    drawUsageReservations: createCapacityReservationsRepo(db, "draw"),
    drawUsageCommits: createCapacityCommitsRepo(db, "draw"),
    capacityRequests: createCapacityRequestsRepo(db),
    activities: createActivitiesRepo(db),
    outcomes: createOutcomesRepo(db),
    userChannelAddresses: createUserChannelAddressRepo(db),
    appNotifications: createAppNotificationRepo(db),
    extensionRecordings: createExtensionRecordingsRepo(db),
    extensionRuntime: createExtensionRuntimeRepo(db),
    auditActionPolicies: createAuditActionPoliciesRepo(db),
    branches: createBranchesRepo(db),
    teams: createTeamsRepo(db),
    integrationJobs: createIntegrationJobRepo(db),
  };
}

export type TestRepositories = ReturnType<typeof createTestRepositories>;
