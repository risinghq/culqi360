import { For, Show } from "solid-js";

import { Input } from "~/components/ui/input/input";
import { Select } from "~/components/ui/input/select";
import type { CaseDetailView, CaseFieldView } from "~/contracts/cases/views";

type CaseValues = CaseDetailView["values"];

// A form holds every value as the text its input shows.
export type CaseFormValues = Record<string, string>;

export function toFormValues(
  fields: readonly CaseFieldView[],
  values: CaseValues,
): CaseFormValues {
  return Object.fromEntries(
    fields.map((field) => [field.key, String(values[field.key] ?? "")]),
  );
}

// An empty input clears the field. A number the input cannot read goes as
// text, so the server names the field it rejects.
export function fromFormValues(
  fields: readonly CaseFieldView[],
  form: CaseFormValues,
): CaseValues {
  return Object.fromEntries(
    fields.map((field) => {
      const raw = (form[field.key] ?? "").trim();
      if (raw === "") {
        return [field.key, null];
      }
      if (field.kind === "number") {
        const number = Number(raw);
        return [field.key, Number.isFinite(number) ? number : raw];
      }
      return [field.key, raw];
    }),
  );
}

export function displayValue(value: string | number | null | undefined) {
  return value === null || value === undefined || value === ""
    ? "Sin dato"
    : String(value);
}

export function CaseFieldInput(props: {
  field: CaseFieldView;
  value: string;
  disabled: boolean;
  onInput: (value: string) => void;
}) {
  const label = () =>
    props.field.required ? `${props.field.label} *` : props.field.label;

  return (
    <Show
      when={props.field.kind === "choice"}
      fallback={
        <Input
          label={label()}
          type={
            props.field.kind === "number"
              ? "number"
              : props.field.kind === "date"
                ? "date"
                : "text"
          }
          value={props.value}
          disabled={props.disabled}
          onInput={(event) => props.onInput(event.currentTarget.value)}
        />
      }
    >
      <Select
        label={label()}
        value={props.value}
        disabled={props.disabled}
        onInput={(event) => props.onInput(event.currentTarget.value)}
      >
        <option value="">Sin elegir</option>
        <For each={props.field.choices ?? []}>
          {(choice) => <option value={choice}>{choice}</option>}
        </For>
      </Select>
    </Show>
  );
}
