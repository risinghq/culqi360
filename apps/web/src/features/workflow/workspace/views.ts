import type { ListLeadsFiltersInput } from "~/contracts/workflow/inputs";
import {
  hasPermission,
  type Permission,
  type PermissionHolder,
} from "~/domain/auth/access/rbac";

export type WorkspaceView = {
  readonly id: string;
  readonly label: string;
  readonly filters: (actorUserId: string) => ListLeadsFiltersInput;
  readonly permission?: Permission;
};

const WORKSPACE_VIEWS: readonly WorkspaceView[] = [
  {
    id: "mine",
    label: "Mis clientes",
    filters: (userId) => ({
      executiveId: userId,
    }),
  },
  {
    id: "review",
    label: "Revisión",
    filters: () => ({ stage: "QUALIFYING" }),
    permission: "lead:review",
  },
  {
    id: "pricing",
    label: "Tarifa",
    filters: () => ({ stage: "PRICING" }),
    permission: "quotation:create",
  },
  {
    id: "all",
    label: "Todos",
    filters: () => ({}),
    permission: "lead:view:all",
  },
];

const DEFAULT_VIEW_BY_ROLE: Partial<Record<string, string>> = {
  supervisor: "all",
  sales_manager: "all",
  back_office: "review",
  admin: "all",
  superuser: "all",
};

export interface ViewMember extends PermissionHolder {
  role: string;
}

export function viewsForRole(member: PermissionHolder): WorkspaceView[] {
  return WORKSPACE_VIEWS.filter(
    (view) => !view.permission || hasPermission(member, view.permission),
  );
}

export function defaultViewIdForRole(member: ViewMember): string {
  const views = viewsForRole(member);
  const configured = DEFAULT_VIEW_BY_ROLE[member.role];

  if (configured && views.some((view) => view.id === configured)) {
    return configured;
  }

  const defaultView = views[0];

  if (!defaultView) {
    throw new Error("The lead index requires at least one available view");
  }

  return defaultView.id;
}

export function resolveWorkspaceView(
  available: readonly WorkspaceView[],
  defaultViewId: string,
  viewParam: string | undefined,
): WorkspaceView {
  const match =
    available.find((view) => view.id === viewParam) ??
    available.find((view) => view.id === defaultViewId) ??
    available[0];

  if (!match) {
    throw new Error("The lead index requires at least one available view");
  }

  return match;
}
