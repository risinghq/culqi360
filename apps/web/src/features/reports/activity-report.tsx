import { useAction, useSearchParams } from "@solidjs/router";
import { For, Loading, Show, createMemo } from "solid-js";

import { createActionPending } from "~/browser/ui/action-in-flight";
import { EmptyState } from "~/components/feedback/empty-state/empty";
import { Skeleton } from "~/components/ui/feedback/skeleton";
import { Input } from "~/components/ui/input/input";
import { Select } from "~/components/ui/input/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/layout/table";
import type {
  ActivityQueryView,
  ReportFiltersView,
} from "~/contracts/reports/views";
import {
  ACTIVITY_CHANNELS,
  ACTIVITY_CHANNEL_LABELS,
  type ActivityChannelKey,
} from "~/domain/activities/channel";
import {
  ACTIVITY_SCREEN_LIMIT,
  activityRangeProblem,
} from "~/domain/reports/activity-range";
import { appCalendarDateAt, formatAppDateTime } from "~/domain/time/app-time";
import {
  calendarMonthFromDate,
  calendarMonthStart,
  parseCalendarDate,
} from "~/domain/time/calendar-date";
import { activityReportQuery } from "~/rpc/reports/queries";

import { exportActivityMutation } from "./data/mutations";
import { ExportButton } from "./export-button";

import styles from "./reports.module.css";

const RANGE_MESSAGES = {
  reversed: "Hasta debe ser igual o posterior a Desde.",
  too_long: "Elige un rango de hasta un año.",
} as const;

function asChannel(value: unknown): ActivityChannelKey | null {
  return ACTIVITY_CHANNELS.find((channel) => channel === value) ?? null;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) {
    return "";
  }
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export function ActivityReport(props: { filters: ReportFiltersView }) {
  const [search, setSearch] = useSearchParams();
  const today = appCalendarDateAt(Date.now());
  const from = () =>
    parseCalendarDate(search.from) ??
    calendarMonthStart(calendarMonthFromDate(today));
  const to = () => parseCalendarDate(search.to) ?? today;
  const channel = () => asChannel(search.channel);
  const userId = () =>
    props.filters.users.find((user) => user.id === search.user)?.id ?? null;
  const outcomes = () =>
    props.filters.outcomes.filter(
      (outcome) => channel() === null || outcome.channel === channel(),
    );
  const outcomeId = () =>
    outcomes().find((outcome) => outcome.id === search.outcome)?.id ?? null;
  const rangeError = () => {
    const problem = activityRangeProblem(from(), to());
    return problem === null ? undefined : RANGE_MESSAGES[problem];
  };
  const query = (): ActivityQueryView | null =>
    rangeError()
      ? null
      : {
          from: from(),
          to: to(),
          userId: userId(),
          channel: channel(),
          outcomeId: outcomeId(),
        };
  const runExport = useAction(exportActivityMutation);
  const exporting = createActionPending(exportActivityMutation);
  const startExport = () => {
    const current = query();
    return current === null ? null : () => runExport(current);
  };

  return (
    <>
      <div class={styles.toolbar}>
        <div class={styles.filter}>
          <Input
            label="Desde"
            type="date"
            value={from()}
            onChange={(event) =>
              setSearch({ from: event.currentTarget.value || null })
            }
          />
        </div>
        <div class={styles.filter}>
          <Input
            label="Hasta"
            type="date"
            value={to()}
            error={rangeError()}
            onChange={(event) =>
              setSearch({ to: event.currentTarget.value || null })
            }
          />
        </div>
        <Show when={props.filters.reach !== "own"}>
          <div class={styles.filter}>
            <Select
              label="Usuario"
              value={userId() ?? ""}
              onInput={(event) =>
                setSearch({ user: event.currentTarget.value || null })
              }
            >
              <option value="">Todos</option>
              <For each={props.filters.users}>
                {(user) => <option value={user.id}>{user.name}</option>}
              </For>
            </Select>
          </div>
        </Show>
        <div class={styles.filter}>
          <Select
            label="Canal"
            value={channel() ?? ""}
            onInput={(event) =>
              setSearch({
                channel: event.currentTarget.value || null,
                outcome: null,
              })
            }
          >
            <option value="">Todos</option>
            <For each={ACTIVITY_CHANNELS}>
              {(key) => (
                <option value={key}>{ACTIVITY_CHANNEL_LABELS[key]}</option>
              )}
            </For>
          </Select>
        </div>
        <div class={styles.filter}>
          <Select
            label="Resultado"
            value={outcomeId() ?? ""}
            onInput={(event) =>
              setSearch({ outcome: event.currentTarget.value || null })
            }
          >
            <option value="">Todos</option>
            <For each={outcomes()}>
              {(outcome) => <option value={outcome.id}>{outcome.label}</option>}
            </For>
          </Select>
        </div>
        <div class={styles.toolbarActions}>
          <ExportButton start={startExport()} pending={exporting()} />
        </div>
      </div>
      <Show when={query()}>
        {(current) => (
          <Loading fallback={<Skeleton height={200} />}>
            <ActivityTable query={current()} />
          </Loading>
        )}
      </Show>
    </>
  );
}

function ActivityTable(props: { query: ActivityQueryView }) {
  const rows = createMemo(() => activityReportQuery(props.query));

  return (
    <Show
      when={rows().length > 0}
      fallback={
        <EmptyState
          title="Sin actividad"
          description="Aquí aparecen las llamadas y visitas registradas en el rango elegido."
        />
      }
    >
      <Show when={rows().length >= ACTIVITY_SCREEN_LIMIT}>
        <p class={styles.meta}>
          Se muestran las {ACTIVITY_SCREEN_LIMIT} más recientes; Exportar
          descarga todas.
        </p>
      </Show>
      <Table aria-label="Actividad" variant="list">
        <TableHeader>
          <TableRow>
            <TableHead>Fecha</TableHead>
            <TableHead>Usuario</TableHead>
            <TableHead>Empresa</TableHead>
            <TableHead>Contacto</TableHead>
            <TableHead>Caso o campaña</TableHead>
            <TableHead>Resultado</TableHead>
            <TableHead align="right">Duración</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <For each={rows()}>
            {(row) => (
              <TableRow>
                <TableCell class={styles.meta}>
                  {formatAppDateTime(row.startedAt)}
                  <br />
                  {ACTIVITY_CHANNEL_LABELS[row.channel]}
                </TableCell>
                <TableCell>{row.userName}</TableCell>
                <TableCell>
                  <div class={styles.company}>
                    <span class={styles.name}>{row.legalName ?? row.ruc}</span>
                    <span class={styles.meta}>RUC {row.ruc}</span>
                  </div>
                </TableCell>
                <TableCell>{row.contactName ?? ""}</TableCell>
                <TableCell>{row.subject ?? ""}</TableCell>
                <TableCell>{row.outcomeLabel ?? ""}</TableCell>
                <TableCell align="right" class={styles.numeric}>
                  {formatDuration(row.durationSeconds)}
                </TableCell>
              </TableRow>
            )}
          </For>
        </TableBody>
      </Table>
    </Show>
  );
}
