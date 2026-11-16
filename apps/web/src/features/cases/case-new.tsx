import { useAction, useNavigate, useSearchParams } from "@solidjs/router";
import { For, Loading, Show, createMemo, createSignal } from "solid-js";

import { EmptyState } from "~/components/feedback/empty-state/empty";
import { Skeleton } from "~/components/ui/feedback/skeleton";
import { Button } from "~/components/ui/input/button";
import { Input } from "~/components/ui/input/input";
import type { CaseTypeView } from "~/contracts/cases/views";
import { actionErrorMessage } from "~/contracts/errors";
import { caseTypesQuery } from "~/rpc/cases/queries";

import {
  CaseFieldInput,
  fromFormValues,
  requiredFieldKeys,
  toFormValues,
} from "./case-fields";
import { openCaseMutation } from "./data/mutations";

import styles from "./cases.module.css";

export function CaseNew() {
  const [search] = useSearchParams();
  const types = createMemo(() => caseTypesQuery());
  const caseType = createMemo(() => {
    const openable = types().filter((option) => option.canOpen);
    return openable.find((option) => option.key === search.type) ?? openable[0];
  });
  const ruc = () => (typeof search.ruc === "string" ? search.ruc : "");

  return (
    <Loading fallback={<Skeleton height={240} />}>
      <Show
        when={caseType()}
        fallback={
          <EmptyState
            title="No puedes abrir casos"
            description="Tu rol no registra casos en este espacio de trabajo."
          />
        }
      >
        {(selected) => <OpeningForm caseType={selected()} ruc={ruc()} />}
      </Show>
    </Loading>
  );
}

// A campaign batch row passes the company's RUC, so the form shows it instead
// of asking for it.
function OpeningForm(props: { caseType: CaseTypeView; ruc: string }) {
  const open = useAction(openCaseMutation);
  const navigate = useNavigate();
  const fields = () => props.caseType.opening.fields;
  const [form, setForm] = createSignal(toFormValues(fields(), {}));
  const [ruc, setRuc] = createSignal(props.ruc);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string>();
  const required = createMemo(() =>
    requiredFieldKeys(fields(), {
      values: fromFormValues(fields(), form()),
      statuses: {
        [props.caseType.opening.key]: props.caseType.opening.initialStatus,
      },
    }),
  );

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const result = await open({
        caseTypeKey: props.caseType.key,
        ruc: ruc().trim(),
        values: fromFormValues(fields(), form()),
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      navigate(`/cases/${result.value.caseId}`);
    } catch (caught: unknown) {
      setError(actionErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form class={styles.page} onSubmit={(event) => void submit(event)}>
      <header class={styles.caseHeader}>
        <span class={styles.title}>{props.caseType.opening.name}</span>
        <span class={styles.meta}>
          {props.caseType.name}
          <Show when={props.ruc}> · RUC {props.ruc}</Show>
        </span>
      </header>
      <div class={styles.form}>
        <Show when={!props.ruc}>
          <Input
            label="RUC"
            required
            inputmode="numeric"
            maxlength={11}
            value={ruc()}
            disabled={busy()}
            onInput={(event) => setRuc(event.currentTarget.value)}
          />
        </Show>
        <For each={fields()}>
          {(field) => (
            <CaseFieldInput
              field={field}
              value={form()[field.key] ?? ""}
              required={required().has(field.key)}
              disabled={busy()}
              onInput={(value) =>
                setForm((current) => ({ ...current, [field.key]: value }))
              }
            />
          )}
        </For>
        <Show when={error()}>
          {(message) => (
            <p class={styles.error} role="alert">
              {message()}
            </p>
          )}
        </Show>
        <div class={styles.actions}>
          <Button type="submit" loading={busy()} disabled={busy()}>
            Abrir caso
          </Button>
        </div>
      </div>
    </form>
  );
}
