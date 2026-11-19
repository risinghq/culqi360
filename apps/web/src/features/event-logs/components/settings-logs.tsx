import { createSignal, Loading, Show, type Accessor } from "solid-js";

import Pause from "~/components/icons/pause";
import Play from "~/components/icons/play";
import { Skeleton } from "~/components/ui/feedback/skeleton";
import { LightIconButton } from "~/components/ui/input/light-icon-button";
import { Card } from "~/components/ui/surfaces/card";
import type { EventLogQueryInput } from "~/contracts/event-logs/event-log";

import { createEventLogQuery } from "../data/create-event-log-query";
import { EVENT_LOG_COLUMNS } from "../model/event-log-columns";
import { EventLogFilters } from "./event-log-filters";
import { EventLogResultsTable } from "./event-log-results-table";

import styles from "./settings-logs.module.css";

export function SettingsLogs(props: {
  input: Accessor<EventLogQueryInput>;
  onFiltersChange: (filters: EventLogQueryInput["filters"]) => void;
}) {
  const [isPaused, setIsPaused] = createSignal(false);
  const query = createEventLogQuery({
    input: props.input,
    liveEnabled: () => !isPaused(),
  });

  return (
    <div class={styles.root}>
      <Card rounded fullWidth backgroundColor="var(--surface)">
        <div class={styles.cardContent}>
          <EventLogFilters
            value={props.input().filters ?? {}}
            onChange={props.onFiltersChange}
          />
        </div>
      </Card>
      <div class={styles.results}>
        <div class={styles.statusRow}>
          <Show when={query.connection() === "offline"}>
            <span class={styles.offlineNotice}>
              Sin conexión. Intentando reconectar...
            </span>
          </Show>
          <Show when={query.connection() === "denied"}>
            <span class={styles.deniedNotice}>
              Se perdió la conexión. Recarga la página.
            </span>
          </Show>
          <Loading fallback={<Skeleton width={96} />}>
            <span class={styles.recordCount}>
              {query.records().length} de {query.totalCount()}
            </span>
          </Loading>
          <LightIconButton
            Icon={isPaused() ? Play : Pause}
            accent="secondary"
            size="medium"
            aria-label={isPaused() ? "Reanudar" : "Pausar"}
            onClick={() => setIsPaused((paused) => !paused)}
          />
        </div>
        {/* The first page suspends here; paging past it keeps the committed
            rows on screen and reports itself through loadingMore instead. */}
        <Loading fallback={<Skeleton height={320} />}>
          <EventLogResultsTable
            columns={EVENT_LOG_COLUMNS}
            records={query.records()}
            loadingMore={query.loadingMore()}
            hasNextPage={query.hasNextPage()}
            onLoadMore={query.loadMore}
          />
        </Loading>
      </div>
    </div>
  );
}
