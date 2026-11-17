import { useAction } from "@solidjs/router";
import { For, Loading, Show, createMemo, createSignal } from "solid-js";

import { useSnackBar } from "~/components/feedback/snack-bar-manager/use-snack-bar";
import { SettingsSection } from "~/components/settings/SettingsSection";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { Skeleton } from "~/components/ui/feedback/skeleton";
import { Button } from "~/components/ui/input/button";
import { Checkbox } from "~/components/ui/input/checkbox";
import { Input } from "~/components/ui/input/input";
import { Select } from "~/components/ui/input/select";
import type { OutcomeView } from "~/contracts/activities/views";
import { actionErrorMessage } from "~/contracts/errors";
import { outcomesQuery } from "~/rpc/activities/queries";

import {
  archiveOutcomeMutation,
  createOutcomeMutation,
  updateOutcomeMutation,
  type OutcomeFlags,
} from "./data/mutations";
import { CHANNEL_LABELS } from "./outcome-picker";

import styles from "./outcomes-section.module.css";

type Channel = OutcomeView["channel"];

const FLAG_LABELS = {
  contacted: "Hubo contacto",
  negotiated: "Hubo negociación",
  callback: "Requiere seguimiento",
} as const;

const FLAGS = ["contacted", "negotiated", "callback"] as const;

const CHANNELS: readonly Channel[] = ["call", "visit"];

const EMPTY: OutcomeFlags = {
  label: "",
  contacted: false,
  negotiated: false,
  callback: false,
};

function flagSummary(outcome: OutcomeView): string {
  const set = FLAGS.filter((flag) => outcome[flag] === true).map(
    (flag) => FLAG_LABELS[flag],
  );
  return set.length > 0 ? set.join(" · ") : "Sin contacto";
}

export function OutcomesSection() {
  const outcomes = createMemo(() => outcomesQuery());
  const create = useAction(createOutcomeMutation);
  const update = useAction(updateOutcomeMutation);
  const archive = useAction(archiveOutcomeMutation);
  const { enqueueErrorSnackBar, enqueueSuccessSnackBar } = useSnackBar();

  const [editingId, setEditingId] = createSignal<string>();
  const [channel, setChannel] = createSignal<Channel>("call");
  const [form, setForm] = createSignal<OutcomeFlags>(EMPTY);
  const [busy, setBusy] = createSignal(false);
  const [archiving, setArchiving] = createSignal<OutcomeView>();

  const ready = () => form().label.trim() !== "";
  const patch = (changes: Partial<OutcomeFlags>) =>
    setForm({ ...form(), ...changes });

  function reset(): void {
    setEditingId(undefined);
    setForm(EMPTY);
  }

  function edit(outcome: OutcomeView): void {
    setEditingId(outcome.id);
    setChannel(outcome.channel);
    setForm({
      label: outcome.label,
      contacted: outcome.contacted === true,
      negotiated: outcome.negotiated === true,
      callback: outcome.callback === true,
    });
  }

  async function submit(): Promise<void> {
    if (!ready()) {
      return;
    }
    setBusy(true);
    try {
      const id = editingId();
      const { message } = id
        ? await update({ id, ...form() })
        : await create({ channel: channel(), ...form() });
      enqueueSuccessSnackBar(message);
      reset();
    } catch (caught: unknown) {
      enqueueErrorSnackBar(actionErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function confirmArchive(): Promise<void> {
    const outcome = archiving();
    if (!outcome) {
      return;
    }
    setBusy(true);
    try {
      const { message } = await archive(outcome.id);
      enqueueSuccessSnackBar(message);
      setArchiving(undefined);
      if (editingId() === outcome.id) {
        reset();
      }
    } catch (caught: unknown) {
      enqueueErrorSnackBar(actionErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsSection
      title="Resultados"
      description="Los resultados que tu equipo elige al cerrar una llamada o una visita."
    >
      <form
        class={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Select
          label="Canal"
          value={channel()}
          disabled={busy() || editingId() !== undefined}
          onInput={(event) => {
            const picked = CHANNELS.find(
              (each) => each === event.currentTarget.value,
            );
            if (picked) {
              setChannel(picked);
            }
          }}
        >
          <For each={CHANNELS}>
            {(each) => <option value={each}>{CHANNEL_LABELS[each]}</option>}
          </For>
        </Select>
        <Input
          label="Nombre"
          value={form().label}
          maxlength={80}
          disabled={busy()}
          onInput={(event) => patch({ label: event.currentTarget.value })}
        />
        <div class={styles.flags}>
          <For each={FLAGS}>
            {(flag) => (
              <Checkbox
                label={FLAG_LABELS[flag]}
                checked={form()[flag]}
                disabled={busy()}
                onChange={(event) =>
                  patch({ [flag]: event.currentTarget.checked })
                }
              />
            )}
          </For>
        </div>
        <div class={styles.actions}>
          <Button type="submit" loading={busy()} disabled={busy() || !ready()}>
            {editingId() ? "Guardar cambios" : "Agregar resultado"}
          </Button>
          <Show when={editingId()}>
            <Button type="button" variant="ghost" onClick={reset}>
              Cancelar
            </Button>
          </Show>
        </div>
      </form>

      <Loading fallback={<Skeleton height={160} />}>
        <For each={["call", "visit"] as const}>
          {(group) => (
            <div class={styles.group}>
              <h3 class={styles.groupTitle}>{CHANNEL_LABELS[group]}</h3>
              <ul class={styles.list}>
                <For
                  each={outcomes().filter(
                    (outcome) => outcome.channel === group,
                  )}
                  fallback={
                    <li class={styles.hint}>
                      Sin resultados. Agrega uno arriba.
                    </li>
                  }
                >
                  {(outcome) => (
                    <li class={styles.row}>
                      <div>
                        <span class={styles.label}>{outcome.label}</span>
                        <span class={styles.hint}>{flagSummary(outcome)}</span>
                      </div>
                      <div class={styles.rowActions}>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => edit(outcome)}
                        >
                          Editar
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setArchiving(outcome)}
                        >
                          Archivar
                        </Button>
                      </div>
                    </li>
                  )}
                </For>
              </ul>
            </div>
          )}
        </For>
      </Loading>

      <ConfirmDialog
        isOpen={archiving() !== undefined}
        title={`¿Archivar ${archiving()?.label ?? ""}?`}
        description="Deja de aparecer al registrar resultados. Las llamadas y visitas que ya lo usan lo conservan."
        confirmLabel="Archivar"
        variant="destructive"
        loading={busy()}
        onConfirm={() => void confirmArchive()}
        onClose={() => setArchiving(undefined)}
      />
    </SettingsSection>
  );
}
