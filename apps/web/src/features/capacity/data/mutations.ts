import { action } from "@solidjs/router";
import { respond } from "@solidjs/web";

import {
  approveCapacity,
  grantMoreDrawRefill,
  grantMoreSearches,
  rejectCapacity,
} from "~/rpc/capacity/approvals";
import { capacityPolicyDefaultsQuery } from "~/rpc/capacity/capacity-policy-defaults";
import { executiveCapacityDetailQuery } from "~/rpc/capacity/executive-capacity-detail";
import { managedExecutivesQuery } from "~/rpc/capacity/managed-executives";
import { myContactHoldCapacityQuery } from "~/rpc/capacity/my-contact-hold-capacity";
import { mySearchAllowanceQuery } from "~/rpc/capacity/my-search-allowance";
import { pendingCapacityRequestsQuery } from "~/rpc/capacity/pending-capacity-requests";
import {
  updateExecutivePolicyOverride,
  updateScopePolicy,
} from "~/rpc/capacity/policies";
import {
  requestMoreDrawRefill,
  requestMoreSearches,
} from "~/rpc/capacity/requests";

export const requestMoreSearchesMutation = action(
  async (amount: number, reason: string) => {
    const result = await requestMoreSearches(amount, reason);
    return respond(result, {
      revalidate: [
        mySearchAllowanceQuery.key,
        pendingCapacityRequestsQuery.key,
      ],
    });
  },
  "requestMoreSearches",
);

export const requestMoreDrawRefillMutation = action(
  async (amount: number, reason: string) => {
    const result = await requestMoreDrawRefill(amount, reason);
    return respond(result, {
      revalidate: [
        myContactHoldCapacityQuery.key,
        pendingCapacityRequestsQuery.key,
      ],
    });
  },
  "requestMoreDrawRefill",
);

export const approveCapacityRequestMutation = action(
  async (requestId: string, note?: string) => {
    const result = await approveCapacity(requestId, note);
    return respond(result, {
      revalidate: [
        pendingCapacityRequestsQuery.key,
        managedExecutivesQuery.key,
        executiveCapacityDetailQuery.key,
        mySearchAllowanceQuery.key,
        myContactHoldCapacityQuery.key,
      ],
    });
  },
  "approveCapacityRequest",
);

export const rejectCapacityRequestMutation = action(
  async (requestId: string, note: string) => {
    const result = await rejectCapacity(requestId, note);
    return respond(result, {
      revalidate: [
        pendingCapacityRequestsQuery.key,
        managedExecutivesQuery.key,
        executiveCapacityDetailQuery.key,
      ],
    });
  },
  "rejectCapacityRequest",
);

export const grantMoreSearchesMutation = action(
  async (userId: string, amount: number, reason: string) => {
    const result = await grantMoreSearches(userId, amount, reason);
    return respond(result, {
      revalidate: [
        managedExecutivesQuery.key,
        executiveCapacityDetailQuery.key,
        pendingCapacityRequestsQuery.key,
      ],
    });
  },
  "grantMoreSearches",
);

export const grantMoreDrawRefillMutation = action(
  async (userId: string, amount: number, reason: string) => {
    const result = await grantMoreDrawRefill(userId, amount, reason);
    return respond(result, {
      revalidate: [
        managedExecutivesQuery.key,
        executiveCapacityDetailQuery.key,
        pendingCapacityRequestsQuery.key,
      ],
    });
  },
  "grantMoreDrawRefill",
);

export const updateExecutivePolicyOverrideMutation = action(
  async (input: {
    userId: string;
    monthlySearchLimit: number;
    activeBufferTarget: number;
    dailyRefillLimit: number;
    expiresAt: number | null;
  }) => {
    const result = await updateExecutivePolicyOverride(input);
    return respond(result, {
      revalidate: [
        managedExecutivesQuery.key,
        executiveCapacityDetailQuery.key,
      ],
    });
  },
  "updateExecutivePolicyOverride",
);

export const updateScopePolicyMutation = action(
  async (input: {
    scopeType: "branch" | "team";
    scopeId: string;
    monthlySearchLimit: number;
    activeBufferTarget: number;
    dailyRefillLimit: number;
  }) => {
    const result = await updateScopePolicy(input);
    return respond(result, {
      revalidate: [capacityPolicyDefaultsQuery.key, managedExecutivesQuery.key],
    });
  },
  "updateScopePolicy",
);
