import { For, Loading, Show, createMemo } from "solid-js";

import { Skeleton } from "~/components/ui/feedback/skeleton";
import { Select } from "~/components/ui/input/select";
import { Textarea } from "~/components/ui/input/textarea";
import type { OutcomeView } from "~/contracts/activities/views";
import { ACTIVITY_CHANNEL_LABELS } from "~/domain/activities/channel";
import { outcomesQuery } from "~/rpc/activities/queries";

/** The result a worker records for a call or a visit, with optional notes. */
export function OutcomePicker(props: {
  outcomeId: string;
  notes: string;
  disabled?: boolean;
  onOutcome: (id: string) => void;
  onNotes: (notes: string) => void;
}) {
  const outcomes = createMemo(() => outcomesQuery());
  const byChannel = (channel: OutcomeView["channel"]) =>
    outcomes().filter((outcome) => outcome.channel === channel);

  return (
    <Loading fallback={<Skeleton height={96} />}>
      <Select
        label="Resultado"
        value={props.outcomeId}
        disabled={props.disabled}
        required
        onInput={(event) => props.onOutcome(event.currentTarget.value)}
      >
        <option value="" disabled>
          Elige un resultado
        </option>
        <For each={["call", "visit"] as const}>
          {(channel) => (
            <Show when={byChannel(channel).length > 0}>
              <optgroup label={ACTIVITY_CHANNEL_LABELS[channel]}>
                <For each={byChannel(channel)}>
                  {(outcome) => (
                    <option value={outcome.id}>{outcome.label}</option>
                  )}
                </For>
              </optgroup>
            </Show>
          )}
        </For>
      </Select>
      <Textarea
        label="Notas"
        rows={3}
        maxlength={2000}
        value={props.notes}
        disabled={props.disabled}
        onInput={(event) => props.onNotes(event.currentTarget.value)}
      />
    </Loading>
  );
}
