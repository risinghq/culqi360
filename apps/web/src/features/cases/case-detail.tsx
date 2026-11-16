import { revalidate, useAction } from "@solidjs/router";
import { For, Loading, Show, createMemo, createSignal } from "solid-js";

import { useSnackBar } from "~/components/feedback/snack-bar-manager/use-snack-bar";
import { Badge } from "~/components/ui/display/badge";
import { Skeleton } from "~/components/ui/feedback/skeleton";
import { Button } from "~/components/ui/input/button";
import { Select } from "~/components/ui/input/select";
import type { CaseDetailView, CaseStageView } from "~/contracts/cases/views";
import { actionErrorMessage } from "~/contracts/errors";
import { formatAppDateTime } from "~/domain/time/app-time";
import { caseQuery } from "~/rpc/cases/queries";

import {
  CaseFieldInput,
  displayValue,
  fromFormValues,
  toFormValues,
} from "./case-fields";
import { writeCaseStageMutation } from "./data/mutations";

import styles from "./cases.module.css";

const ACCESS_HINTS: Record<
  Exclude<CaseStageView["access"], "writable">,
  string
> = {
  not_owned: "Otro rol completa esta etapa.",
  not_open: "Esta etapa se abre cuando la anterior avanza.",
  locked: "Esta etapa ya está cerrada.",
};

export function CaseDetail(props: { caseId: string }) {
  const detail = createMemo(() => caseQuery(props.caseId));

  return (
    <Loading fallback={<Skeleton height={320} />}>
      <div class={styles.page}>
        <header class={styles.caseHeader}>
          <span class={styles.title}>{detail().legalName ?? detail().ruc}</span>
          <span class={styles.meta}>
            RUC {detail().ruc} · {detail().caseType.name} · Responsable{" "}
            {detail().ownerName}
          </span>
        </header>
        <For each={detail().stages}>
          {(stage) => <CaseStage detail={detail()} stage={stage} />}
        </For>
      </div>
    </Loading>
  );
}

function CaseStage(props: { detail: CaseDetailView; stage: CaseStageView }) {
  return (
    <section class={styles.stage}>
      <div class={styles.stageHeader}>
        <div class={styles.company}>
          <span class={styles.title}>{props.stage.name}</span>
          <span class={styles.meta}>{props.stage.ownerRoleLabel}</span>
        </div>
        <Badge variant="secondary">{props.stage.status}</Badge>
      </div>
      <Show
        when={props.stage.access === "writable"}
        fallback={<StageValues detail={props.detail} stage={props.stage} />}
      >
        <StageForm detail={props.detail} stage={props.stage} />
      </Show>
      <Show when={props.stage.lastAuthor}>
        {(author) => (
          <span class={styles.meta}>
            Guardado por {author().name ?? "un usuario retirado"} el{" "}
            {formatAppDateTime(author().at)}
          </span>
        )}
      </Show>
    </section>
  );
}

function StageValues(props: { detail: CaseDetailView; stage: CaseStageView }) {
  const hint = () => {
    const access = props.stage.access;
    return access === "writable" ? undefined : ACCESS_HINTS[access];
  };
  return (
    <>
      <Show when={props.stage.fields.length > 0}>
        <dl class={styles.values}>
          <For each={props.stage.fields}>
            {(field) => (
              <div class={styles.value}>
                <dt>{field.label}</dt>
                <dd>{displayValue(props.detail.values[field.key])}</dd>
              </div>
            )}
          </For>
        </dl>
      </Show>
      <Show when={hint()}>
        {(text) => <span class={styles.hint}>{text()}</span>}
      </Show>
    </>
  );
}

function StageForm(props: { detail: CaseDetailView; stage: CaseStageView }) {
  const write = useAction(writeCaseStageMutation);
  const { enqueueSuccessSnackBar } = useSnackBar();
  const [form, setForm] = createSignal(
    toFormValues(props.stage.editableFields, props.detail.values),
  );
  const [status, setStatus] = createSignal(props.stage.status);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string>();
  const [conflict, setConflict] = createSignal(false);

  async function save(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    setConflict(false);
    try {
      const result = await write({
        caseId: props.detail.id,
        expectedVersion: props.detail.version,
        stageKey: props.stage.key,
        status: status(),
        values: fromFormValues(props.stage.editableFields, form()),
      });
      if (!result.ok) {
        setError(result.error.message);
        setConflict(result.error.code === "case_conflict");
        return;
      }
      enqueueSuccessSnackBar(`${props.stage.name} guardada.`);
    } catch (caught: unknown) {
      setError(actionErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form class={styles.form} onSubmit={(event) => void save(event)}>
      <For each={props.stage.editableFields}>
        {(field) => (
          <CaseFieldInput
            field={field}
            value={form()[field.key] ?? ""}
            disabled={busy()}
            onInput={(value) =>
              setForm((current) => ({ ...current, [field.key]: value }))
            }
          />
        )}
      </For>
      <Select
        label="Estado"
        value={status()}
        disabled={busy()}
        onInput={(event) => setStatus(event.currentTarget.value)}
      >
        <For each={props.stage.statuses}>
          {(option) => <option value={option}>{option}</option>}
        </For>
      </Select>
      <Show when={error()}>
        {(message) => (
          <p class={styles.error} role="alert">
            {message()}
          </p>
        )}
      </Show>
      <div class={styles.actions}>
        <Button type="submit" loading={busy()} disabled={busy()}>
          Guardar
        </Button>
        <Show when={conflict()}>
          <Button
            type="button"
            variant="outline"
            onClick={() => revalidate(caseQuery.key)}
          >
            Recargar
          </Button>
        </Show>
      </div>
    </form>
  );
}
