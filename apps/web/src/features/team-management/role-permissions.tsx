import { Dynamic } from "@solidjs/web";
import { For } from "solid-js";

import Activity from "~/components/icons/activity";
import ChartColumn from "~/components/icons/chart-column";
import List from "~/components/icons/list";
import Moneybag from "~/components/icons/moneybag";
import Package from "~/components/icons/package";
import Search from "~/components/icons/search";
import Settings from "~/components/icons/settings";
import UserRound from "~/components/icons/user-round";
import Users from "~/components/icons/users";
import { Checkbox } from "~/components/ui/input/checkbox";
import {
  groupPermissions,
  type PermissionGroupId,
} from "~/domain/auth/access/permission-display";
import type { Permission } from "~/domain/auth/access/rbac";

import styles from "./team-management.module.css";

const GROUP_ICON: Record<PermissionGroupId, typeof Activity> = {
  clientes: UserRound,
  ventas: Moneybag,
  cotizaciones: List,
  busqueda: Search,
  capacidad: Activity,
  entregas: Package,
  equipo: Users,
  negocio: ChartColumn,
  administracion: Settings,
};

// Read-only unless `onToggle` is given.
export function RolePermissions(props: {
  granted: readonly Permission[];
  shown?: readonly Permission[];
  onToggle?: (permission: Permission, granted: boolean) => void;
}) {
  const sections = () => groupPermissions(props.granted, props.shown);

  return (
    <div class={styles.permGroups}>
      <For each={sections()}>
        {(section) => (
          <section>
            <header class={styles.permSectionHeader}>
              <Dynamic
                component={GROUP_ICON[section.group.id]}
                class={styles.permGroupIcon}
              />
              <span>{section.group.label}</span>
            </header>
            <div class={styles.permRows}>
              <For each={section.permissions}>
                {(permission) => (
                  <div class={styles.permRow}>
                    <div class={styles.permText}>
                      <span class={styles.permName}>{permission.label}</span>
                      <span class={styles.permDesc}>
                        {permission.description}
                      </span>
                    </div>
                    <Checkbox
                      checked={permission.granted}
                      disabled={!props.onToggle}
                      aria-label={permission.label}
                      onChange={(event) =>
                        props.onToggle?.(
                          permission.key,
                          event.currentTarget.checked,
                        )
                      }
                    />
                  </div>
                )}
              </For>
            </div>
          </section>
        )}
      </For>
    </div>
  );
}
