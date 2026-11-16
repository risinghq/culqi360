import { useAction, useNavigate, useSearchParams } from "@solidjs/router";
import { For, Loading, Show, createMemo, createSignal } from "solid-js";

import { EmptyState } from "~/components/feedback/empty-state/empty";
import { Skeleton } from "~/components/ui/feedback/skeleton";
import { Button } from "~/components/ui/input/button";
import type { CaseTypeView } from "~/contracts/cases/views";
import { actionErrorMessage } from "~/contracts/errors";
import { caseTypesQuery } from "~/rpc/cases/queries";

import { CaseFieldInput, fromFormValues, toFormValues } from "./case-fields";
import { openCaseMutation } from "./data/mutations";

import styles from "./cases.module.css";

export function CaseNew() {
  const [search] = useSearchParams();
  const types = createMemo(() => caseTypesQuery());
  const caseType = createMemo(() => {
    const openable = types().filter((option) => option.canOpen);
    return openable.find((option) => option.key === search.type) ?? openable[0];
  });
  const organizationId = () =>
    typeof search.organization === "string" ? search.organization : "";
  const ruc = () => (typeof search.ruc === "string" ? search.ruc : "");

  return (
    <Loading fallback={<Skeleton height={240} />}>
      <Show
        when={organizationId() !== "" ? caseType() : undefined}
        fallback={
          <EmptyState
            title="No puedes abrir este caso"
            description="Abre un caso desde una empresa de tu lote de campaña."
          />
        }
      >
        {(selected) => (
          <OpeningForm
            caseType={selected()}
            organizationId={organizationId()}
            ruc={ruc()}
          />
        )}
      </Show>
    </Loading>
  );
}

function OpeningForm(props: {
  caseType: CaseTypeView;
  organizationId: string;
  ruc: string;
}) {
  const open = useAction(openCaseMutation);
  const navigate = useNavigate();
  const fields = () => props.caseType.opening.fields;
  const [form, setForm] = createSignal(toFormValues(fields(), {}));
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string>();

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const result = await open({
        caseTypeKey: props.caseType.key,
        organizationId: props.organizationId,
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
        <For each={fields()}>
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
