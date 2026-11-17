import { For, Show, createMemo } from "solid-js";

import { EmptyState } from "~/components/feedback/empty-state/empty";
import Phone from "~/components/icons/phone";
import { AppPage } from "~/components/layout/page";
import { CallWithExtension } from "~/features/extension/call-with-extension";
import { myContactHoldsQuery } from "~/rpc/contacts/my-holds";

import styles from "./assignments-page.module.css";

export default function MyAssignmentsPage() {
  const holds = createMemo(() => myContactHoldsQuery(), {
    loadingValue: [],
  });

  return (
    <AppPage width="medium">
      <Show
        when={holds().length > 0}
        fallback={
          <EmptyState
            icon={Phone}
            title="Sin contactos asignados"
            description="Solicita nuevas asignaciones desde Mi capacidad."
          />
        }
      >
        <ul class={styles.list}>
          <For each={holds()}>
            {(hold) => (
              <li class={styles.row}>
                <div class={styles.contact}>
                  <span class={styles.name}>{hold.name}</span>
                  <span class={styles.phone}>
                    {hold.phone ?? "Sin teléfono"}
                  </span>
                </div>
                <Show when={hold.phone}>
                  <CallWithExtension
                    request={{
                      subject: {
                        kind: "contact_hold",
                        id: hold.holdId,
                      },
                    }}
                  />
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </AppPage>
  );
}
