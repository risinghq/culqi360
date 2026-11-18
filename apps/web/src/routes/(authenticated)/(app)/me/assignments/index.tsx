import { useAction } from "@solidjs/router";
import { For, Show, createMemo, createSignal } from "solid-js";

import { EmptyState } from "~/components/feedback/empty-state/empty";
import { useSnackBar } from "~/components/feedback/snack-bar-manager/use-snack-bar";
import Phone from "~/components/icons/phone";
import { AppPage } from "~/components/layout/page";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { Button } from "~/components/ui/input/button";
import type { MyContactHoldView } from "~/contracts/contacts/views";
import { actionErrorMessage } from "~/contracts/errors";
import { completeContactHoldCallMutation } from "~/features/contacts/data/mutations";
import { CallWithExtension } from "~/features/extension/call-with-extension";
import { OutcomePicker } from "~/features/outcomes/outcome-picker";
import { myContactHoldsQuery } from "~/rpc/contacts/my-holds";

import styles from "./assignments-page.module.css";

export default function MyAssignmentsPage() {
  const holds = createMemo(() => myContactHoldsQuery(), {
    loadingValue: [],
  });
  const complete = useAction(completeContactHoldCallMutation);
  const { enqueueErrorSnackBar } = useSnackBar();
  const [recording, setRecording] = createSignal<MyContactHoldView>();
  const [outcomeId, setOutcomeId] = createSignal("");
  const [notes, setNotes] = createSignal("");
  const [saving, setSaving] = createSignal(false);

  function openResult(hold: MyContactHoldView): void {
    setOutcomeId("");
    setNotes("");
    setRecording(hold);
  }

  async function saveResult(): Promise<void> {
    const hold = recording();
    if (!hold || outcomeId() === "") {
      return;
    }
    setSaving(true);
    try {
      await complete({
        holdId: hold.holdId,
        contactId: hold.contactId,
        outcomeId: outcomeId(),
        notes: notes(),
      });
      setRecording(undefined);
    } catch (caught: unknown) {
      enqueueErrorSnackBar(actionErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

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
                <div class={styles.actions}>
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
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => openResult(hold)}
                  >
                    Registrar resultado
                  </Button>
                </div>
              </li>
            )}
          </For>
        </ul>
      </Show>

      <ConfirmDialog
        isOpen={recording() !== undefined}
        title={recording()?.name ?? ""}
        description="El contacto sale de tu lista cuando registras el resultado."
        confirmLabel="Registrar"
        variant="primary"
        loading={saving()}
        confirmDisabled={outcomeId() === ""}
        onConfirm={() => void saveResult()}
        onClose={() => setRecording(undefined)}
      >
        <OutcomePicker
          outcomeId={outcomeId()}
          notes={notes()}
          disabled={saving()}
          onOutcome={setOutcomeId}
          onNotes={setNotes}
        />
      </ConfirmDialog>
    </AppPage>
  );
}
