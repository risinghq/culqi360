import { Checkbox } from "~/components/ui/input/checkbox";
import { Input } from "~/components/ui/input/input";
import type { EventLogFilters as Filters } from "~/contracts/event-logs/event-log";

import { EventLogDatePickerInput } from "./event-log-date-picker-input";

import styles from "./event-log-filters.module.css";

export function EventLogFilters(props: {
  value: Filters;
  onChange: (next: Filters) => void;
}) {
  const patch = (partial: Partial<Filters>) =>
    props.onChange({ ...props.value, ...partial });
  const range = () => props.value.dateRange;

  return (
    <div class={styles.grid}>
      <Input
        label="Acción"
        value={props.value.eventType ?? ""}
        placeholder="Filtrar por evento"
        onInput={(event) =>
          patch({ eventType: event.currentTarget.value || undefined })
        }
      />
      <Input
        label="Actor"
        value={props.value.actorUserId ?? ""}
        placeholder="ID de usuario"
        onInput={(event) =>
          patch({ actorUserId: event.currentTarget.value || undefined })
        }
      />
      <div class={styles.fullWidth}>
        <div class={styles.periodLabel}>Periodo</div>
        <div class={styles.periodRow}>
          <EventLogDatePickerInput
            placeholder="Fecha inicial"
            value={range()?.start}
            onChange={(start) => patch({ dateRange: { ...range(), start } })}
          />
          <EventLogDatePickerInput
            placeholder="Fecha final"
            value={range()?.end}
            onChange={(end) => patch({ dateRange: { ...range(), end } })}
          />
        </div>
      </div>
      <div class={styles.checkboxCell}>
        <Checkbox
          label="Solo riesgo alto"
          checked={props.value.onlyHighRisk ?? false}
          onInput={(event) =>
            patch({ onlyHighRisk: event.currentTarget.checked || undefined })
          }
        />
      </div>
    </div>
  );
}
