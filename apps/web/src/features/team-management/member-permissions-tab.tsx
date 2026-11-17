import { useAction } from "@solidjs/router";
import { createSignal, For, Show } from "solid-js";

import { createActionPending } from "~/browser/ui/action-in-flight";
import { useSnackBar } from "~/components/feedback/snack-bar-manager/use-snack-bar";
import { SettingsSection } from "~/components/settings/SettingsSection";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { Select } from "~/components/ui/input/select";
import { actionErrorMessage } from "~/contracts/errors";
import type { MemberDetail } from "~/contracts/members";
import type { RoleOption } from "~/domain/auth/access/member-management";
import { changeMemberRoleMutation } from "~/features/team-management/data/member-mutations";

import { RolePermissions } from "./role-permissions";

import styles from "./team-management.module.css";

export function MemberPermissionsTab(props: { detail: MemberDetail }) {
  const changeRole = useAction(changeMemberRoleMutation);
  const saving = createActionPending(changeMemberRoleMutation);
  const { enqueueSuccessSnackBar, enqueueErrorSnackBar } = useSnackBar();

  // Selecting a role stages it; the change only commits once confirmed, so the
  // select reverts to the current role on cancel.
  const [pendingRole, setPendingRole] = createSignal<RoleOption | null>(null);
  const [pendingCategory, setPendingCategory] = createSignal(
    props.detail.executiveCategory ?? "",
  );

  const displayRoleId = () => pendingRole()?.value ?? props.detail.roleId;
  // Promoting to executive requires a category before the change can commit.
  const needsCategory = () => pendingRole()?.kind === "executive";
  const confirmDisabled = () => needsCategory() && !pendingCategory();

  function requestRoleChange(value: string) {
    const option = props.detail.assignableRoles.find(
      (role) => role.value === value,
    );
    if (!option || option.value === props.detail.roleId) {
      return;
    }
    setPendingCategory(props.detail.executiveCategory ?? "");
    setPendingRole(option);
  }

  async function confirmRoleChange() {
    const role = pendingRole();
    if (!role) {
      return;
    }
    try {
      const { message } = await changeRole({
        userId: props.detail.id,
        roleId: role.value,
        executiveCategory: needsCategory() ? pendingCategory() : null,
      });
      enqueueSuccessSnackBar(message);
      setPendingRole(null);
    } catch (caught: unknown) {
      enqueueErrorSnackBar(actionErrorMessage(caught));
    }
  }

  return (
    <>
      <Show when={props.detail.canManage}>
        <SettingsSection
          title="Rol"
          description="El rol determina los permisos del miembro. Al cambiarlo se cierran sus sesiones activas."
        >
          <Select
            label="Rol"
            value={displayRoleId()}
            onInput={(event) => requestRoleChange(event.currentTarget.value)}
          >
            <For each={props.detail.assignableRoles}>
              {(option) => <option value={option.value}>{option.label}</option>}
            </For>
          </Select>
        </SettingsSection>

        <ConfirmDialog
          isOpen={pendingRole() !== null}
          title="Confirmar cambio de rol"
          description={`¿Deseas cambiar el rol de este usuario de ${
            props.detail.roleName
          } a ${pendingRole()?.label ?? props.detail.roleName}?`}
          confirmLabel="Actualizar rol"
          confirmDisabled={confirmDisabled()}
          loading={saving()}
          onConfirm={() => void confirmRoleChange()}
          onClose={() => setPendingRole(null)}
        >
          <Show when={needsCategory()}>
            <div class={styles.modalField}>
              <Select
                label="Categoría"
                value={pendingCategory()}
                onInput={(event) =>
                  setPendingCategory(event.currentTarget.value)
                }
                required
              >
                <option value="">Seleccionar categoría...</option>
                <option value="elite">Elite</option>
                <option value="corporativa">Corporativa</option>
              </Select>
            </div>
          </Show>
        </ConfirmDialog>
      </Show>

      <SettingsSection
        title="Permisos"
        description="Lo que este rol puede ver y hacer en el sistema."
      >
        <RolePermissions granted={props.detail.permissions} />
      </SettingsSection>
    </>
  );
}
