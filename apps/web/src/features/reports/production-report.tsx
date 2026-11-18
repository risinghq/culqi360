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
  ProductionQueryView,
  ReportCaseTypeView,
  ReportFiltersView,
} from "~/contracts/reports/views";
import { appCalendarDateAt } from "~/domain/time/app-time";
import {
  calendarMonthFromDate,
  parseCalendarMonth,
} from "~/domain/time/calendar-date";
import { productionReportQuery } from "~/rpc/reports/queries";
import { APP_LOCALE } from "~/shared/locale";

import { exportProductionMutation } from "./data/mutations";
import { ExportButton } from "./export-button";

import styles from "./reports.module.css";

const SUM_FORMAT = new Intl.NumberFormat(APP_LOCALE, {
  maximumFractionDigits: 2,
});

export function ProductionReport(props: { filters: ReportFiltersView }) {
  const [search, setSearch] = useSearchParams();
  const caseType = createMemo(
    () =>
      props.filters.caseTypes.find((type) => type.id === search.type) ??
      props.filters.caseTypes[0],
  );

  return (
    <Show
      when={caseType()}
      fallback={
        <EmptyState
          title="Sin procesos"
          description="Este espacio de trabajo todavía no tiene un proceso de casos."
        />
      }
    >
      {(type) => (
        <ProductionView
          filters={props.filters}
          caseType={type()}
          onCaseType={(id) => setSearch({ type: id, stage: null, sum: null })}
        />
      )}
    </Show>
  );
}

function ProductionView(props: {
  filters: ReportFiltersView;
  caseType: ReportCaseTypeView;
  onCaseType: (id: string) => void;
}) {
  const [search, setSearch] = useSearchParams();
  const stage = () =>
    props.caseType.stages.find((item) => item.key === search.stage) ??
    props.caseType.stages[0];
  const sumField = () =>
    props.caseType.numberFields.find((field) => field.key === search.sum) ??
    null;
  const month = () =>
    parseCalendarMonth(search.month) ??
    calendarMonthFromDate(appCalendarDateAt(Date.now()));
  const query = (): ProductionQueryView | null => {
    const current = stage();
    return current
      ? {
          caseTypeId: props.caseType.id,
          stageKey: current.key,
          sumFieldKey: sumField()?.key ?? null,
          month: month(),
        }
      : null;
  };
  const runExport = useAction(exportProductionMutation);
  const exporting = createActionPending(exportProductionMutation);
  const startExport = () => {
    const current = query();
    return current === null ? null : () => runExport(current);
  };

  return (
    <>
      <div class={styles.toolbar}>
        <Show when={props.filters.caseTypes.length > 1}>
          <div class={styles.filter}>
            <Select
              label="Proceso"
              value={props.caseType.id}
              onInput={(event) => props.onCaseType(event.currentTarget.value)}
            >
              <For each={props.filters.caseTypes}>
                {(option) => <option value={option.id}>{option.name}</option>}
              </For>
            </Select>
          </div>
        </Show>
        <div class={styles.filter}>
          <Select
            label="Etapa"
            value={stage()?.key ?? ""}
            onInput={(event) => setSearch({ stage: event.currentTarget.value })}
          >
            <For each={props.caseType.stages}>
              {(option) => <option value={option.key}>{option.name}</option>}
            </For>
          </Select>
        </div>
        <div class={styles.filter}>
          <Input
            label="Mes"
            type="month"
            value={month()}
            onChange={(event) =>
              setSearch({ month: event.currentTarget.value || null })
            }
          />
        </div>
        <Show when={props.caseType.numberFields.length > 0}>
          <div class={styles.filter}>
            <Select
              label="Sumar"
              value={sumField()?.key ?? ""}
              onInput={(event) =>
                setSearch({ sum: event.currentTarget.value || null })
              }
            >
              <option value="">Nada</option>
              <For each={props.caseType.numberFields}>
                {(field) => <option value={field.key}>{field.label}</option>}
              </For>
            </Select>
          </div>
        </Show>
        <div class={styles.toolbarActions}>
          <ExportButton start={startExport()} pending={exporting()} />
        </div>
      </div>
      <Show when={query()}>
        {(current) => (
          <Loading fallback={<Skeleton height={200} />}>
            <ProductionTable query={current()} />
          </Loading>
        )}
      </Show>
    </>
  );
}

function ProductionTable(props: { query: ProductionQueryView }) {
  const report = createMemo(() => productionReportQuery(props.query));

  return (
    <Show
      when={report().rows.length > 0}
      fallback={
        <EmptyState
          title="Sin casos este mes"
          description="Aquí aparecen los casos abiertos en el mes elegido, por responsable."
        />
      }
    >
      <Table aria-label="Producción" variant="list">
        <TableHeader>
          <TableRow>
            <TableHead>Usuario</TableHead>
            <For each={report().statuses}>
              {(status) => <TableHead align="right">{status}</TableHead>}
            </For>
            <TableHead align="right">Total</TableHead>
            <Show when={report().sumLabel}>
              {(label) => <TableHead align="right">{label()}</TableHead>}
            </Show>
          </TableRow>
        </TableHeader>
        <TableBody>
          <For each={report().rows}>
            {(row) => (
              <TableRow>
                <TableCell>{row.holderName}</TableCell>
                <CountCells counts={row.counts} total={row.total} />
                <SumCell show={report().sumLabel !== null} sum={row.sum} />
              </TableRow>
            )}
          </For>
          <TableRow class={styles.totals}>
            <TableCell>Total</TableCell>
            <CountCells
              counts={report().totals.counts}
              total={report().totals.total}
            />
            <SumCell
              show={report().sumLabel !== null}
              sum={report().totals.sum}
            />
          </TableRow>
        </TableBody>
      </Table>
    </Show>
  );
}

function CountCells(props: { counts: number[]; total: number }) {
  return (
    <>
      <For each={props.counts}>
        {(count) => (
          <TableCell align="right" class={styles.numeric}>
            {count}
          </TableCell>
        )}
      </For>
      <TableCell align="right" class={styles.numeric}>
        {props.total}
      </TableCell>
    </>
  );
}

function SumCell(props: { show: boolean; sum: number | null }) {
  return (
    <Show when={props.show}>
      <TableCell align="right" class={styles.numeric}>
        {SUM_FORMAT.format(props.sum ?? 0)}
      </TableCell>
    </Show>
  );
}
