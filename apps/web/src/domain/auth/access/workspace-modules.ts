import { hasPermission, type Permission, type Role } from "./rbac";

// A module is a set of features a workspace turns on. Culqi's lead workflow,
// pricing, fulfillment and settlement form one. The third-party contact data
// behind search forms another, because each workspace needs its own legal basis
// to use that data. Row-level security isolates the data either way; a module
// decides which features a workspace sees.
export const WORKSPACE_MODULES = ["culqi", "contacts"] as const;

export type WorkspaceModule = (typeof WORKSPACE_MODULES)[number];

// What a user may do: the role's permissions, limited to the workspace's
// modules.
export interface Member {
  role: Role;
  modules: readonly WorkspaceModule[];
}

const PERMISSION_MODULES: Record<Permission, WorkspaceModule | null> = {
  "lead:rate:simulate": "culqi",
  "lead:work": "culqi",
  "lead:workflow": "culqi",
  "lead:register": "culqi",
  "lead:note:add": "culqi",
  "lead:commercial-input:complete": "culqi",
  "lead:sale:create": "culqi",
  "lead:sale:upload-proof": "culqi",
  "lead:view:all": "culqi",
  "lead:delete": "culqi",
  "lead:review": "culqi",
  "lead:reassign": "culqi",
  "sales:create": "culqi",
  "sales:submit": "culqi",
  "sales:review": "culqi",
  "sales:approve": "culqi",
  "quotation:create": "culqi",
  "quotation:revise": "culqi",
  "quotation:view:all": "culqi",
  "quotation:policy:manage": "culqi",
  "integration:manage": "culqi",
  "fulfillment:manage": "culqi",
  "fulfillment:client-step": "culqi",
  "inventory:read": "culqi",
  "inventory:manage": "culqi",
  "commission:read": "culqi",
  "commission:manage": "culqi",
  // The dashboards read leads and merchant stats until cases join them.
  "dashboards:read": "culqi",
  "dashboards:read:own": "culqi",
  "dashboards:manage": "culqi",
  "search:use": "contacts",
  "data-source:import": "contacts",
  // Capacity grants meter how much contact data a user may draw.
  "capacity:read:self": "contacts",
  "capacity:request:self": "contacts",
  "capacity:read:team": "contacts",
  "capacity:manage": "contacts",
  "capacity:approve": "contacts",
  "capacity:policy:manage": "contacts",
  "capacity:audit:read": "contacts",
  "team:read": null,
  "team:manage": null,
  "team:invite": null,
  "hr:read": null,
  "admin:read": null,
  "admin:manage": null,
  "audit:read": null,
  "campaign:work": null,
  "campaign:manage": null,
  "case:work": null,
  "case:view:all": null,
};

export function isWorkspaceModule(value: string): value is WorkspaceModule {
  return WORKSPACE_MODULES.some((module) => module === value);
}

export function hasModule(
  member: Pick<Member, "modules">,
  module: WorkspaceModule | null,
): boolean {
  return module === null || member.modules.includes(module);
}

export function permissionModule(
  permission: Permission,
): WorkspaceModule | null {
  return PERMISSION_MODULES[permission];
}

export function memberHasPermission(
  member: Member,
  permission: Permission,
): boolean {
  return (
    hasModule(member, PERMISSION_MODULES[permission]) &&
    hasPermission(member.role, permission)
  );
}
