import { useAction } from "@solidjs/router";
import { For, Show, createSignal } from "solid-js";

import { downloadWithToken } from "~/browser/files/client";
import { useSnackBar } from "~/components/feedback/snack-bar-manager/use-snack-bar";
import { Button } from "~/components/ui/input/button";
import { FileInput } from "~/components/ui/input/file-input";
import { Input } from "~/components/ui/input/input";
import { Select } from "~/components/ui/input/select";
import type { CaseDetailView, CaseFieldView } from "~/contracts/cases/views";
import { actionErrorMessage } from "~/contracts/errors";
import {
  isFieldRequired,
  type RequirementContext,
} from "~/domain/cases/field-rules";
import { appCalendarDateAt } from "~/domain/time/app-time";

import {
  requestCaseFileTokenMutation,
  uploadCaseFileMutation,
} from "./data/mutations";

import styles from "./cases.module.css";

// Matches the server's case_file extensions.
const CASE_FILE_ACCEPT = ".pdf,.png,.jpg,.jpeg,.xlsx,.xls,.csv";

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

export function requiredFieldKeys(
  fields: readonly CaseFieldView[],
  context: Omit<RequirementContext, "today">,
): ReadonlySet<string> {
  const today = appCalendarDateAt(Date.now());
  return new Set(
    fields
      .filter((field) => isFieldRequired(field, { ...context, today }))
      .map((field) => field.key),
  );
}

// A branch field stores the branch id, so it shows the option's label.
export function displayValue(
  field: CaseFieldView,
  value: string | number | null | undefined,
) {
  if (value === null || value === undefined || value === "") {
    return "Sin dato";
  }
  const option = field.options?.find((each) => each.value === value);
  return option ? option.label : String(value);
}

// The form passes required because a conditional field depends on other values.
// A file field holds the id of an upload; fileName names the saved one.
export function CaseFieldInput(props: {
  field: CaseFieldView;
  value: string;
  fileName?: string | undefined;
  required: boolean;
  disabled: boolean;
  onInput: (value: string) => void;
}) {
  return (
    <Show
      when={props.field.kind !== "file"}
      fallback={
        <CaseFileInput
          label={props.field.label}
          hasFile={props.value !== ""}
          fileName={props.fileName}
          required={props.required}
          disabled={props.disabled}
          onUploaded={props.onInput}
        />
      }
    >
      <CaseValueInput {...props} />
    </Show>
  );
}

// The file uploads as soon as it is picked; the stage save attaches it.
function CaseFileInput(props: {
  label: string;
  hasFile: boolean;
  fileName: string | undefined;
  required: boolean;
  disabled: boolean;
  onUploaded: (fileId: string) => void;
}) {
  const upload = useAction(uploadCaseFileMutation);
  const [uploading, setUploading] = createSignal(false);
  const [error, setError] = createSignal<string>();
  const [uploadedName, setUploadedName] = createSignal<string>();

  async function pick(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    setUploading(true);
    setError(undefined);
    try {
      const result = await upload(file);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setUploadedName(result.value.name);
      props.onUploaded(result.value.id);
    } catch (caught: unknown) {
      setError(actionErrorMessage(caught));
    } finally {
      setUploading(false);
    }
  }

  const shownName = () => uploadedName() ?? props.fileName;

  return (
    <div class={styles.fileField}>
      <FileInput
        label={props.label}
        accept={CASE_FILE_ACCEPT}
        required={props.required && !props.hasFile}
        disabled={props.disabled || uploading()}
        error={error()}
        onChange={(event) => void pick(event.currentTarget)}
      />
      <Show when={uploading()}>
        <span class={styles.meta}>Subiendo archivo…</span>
      </Show>
      <Show when={props.hasFile && !uploading() && shownName()}>
        {(name) => <span class={styles.meta}>Archivo: {name()}</span>}
      </Show>
    </div>
  );
}

export function CaseFileDownload(props: {
  caseId: string;
  fieldKey: string;
  fileName: string;
}) {
  const requestToken = useAction(requestCaseFileTokenMutation);
  const [busy, setBusy] = createSignal(false);
  const { enqueueErrorSnackBar } = useSnackBar();

  async function download(): Promise<void> {
    setBusy(true);
    try {
      const { token } = await requestToken({
        caseId: props.caseId,
        fieldKey: props.fieldKey,
      });
      downloadWithToken(token);
    } catch (caught: unknown) {
      enqueueErrorSnackBar(actionErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      type="button"
      variant="link"
      loading={busy()}
      disabled={busy()}
      onClick={() => void download()}
    >
      {props.fileName}
    </Button>
  );
}

function CaseValueInput(props: {
  field: CaseFieldView;
  value: string;
  required: boolean;
  disabled: boolean;
  onInput: (value: string) => void;
}) {
  return (
    <Show
      when={props.field.options}
      fallback={
        <Input
          label={props.field.label}
          required={props.required}
          type={
            props.field.kind === "number"
              ? "number"
              : props.field.kind === "date"
                ? "date"
                : "text"
          }
          min={props.field.bounds?.min}
          max={props.field.bounds?.max}
          step={props.field.bounds?.integer ? 1 : "any"}
          value={props.value}
          disabled={props.disabled}
          onInput={(event) => props.onInput(event.currentTarget.value)}
        />
      }
    >
      {(options) => (
        <Select
          label={props.field.label}
          required={props.required}
          value={props.value}
          disabled={props.disabled}
          onInput={(event) => props.onInput(event.currentTarget.value)}
        >
          <option value="">Sin elegir</option>
          <For each={options()}>
            {(option) => <option value={option.value}>{option.label}</option>}
          </For>
        </Select>
      )}
    </Show>
  );
}
