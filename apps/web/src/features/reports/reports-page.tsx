import { useSearchParams } from "@solidjs/router";
import { Errored, Loading, Show, createMemo } from "solid-js";

import { EmptyState } from "~/components/feedback/empty-state/empty";
import { Skeleton } from "~/components/ui/feedback/skeleton";
import { actionErrorMessage } from "~/contracts/errors";
import { TabStrip } from "~/features/side-panel/components/tab-strip";
import { reportFiltersQuery } from "~/rpc/reports/queries";

import { ActivityReport } from "./activity-report";
import { ProductionReport } from "./production-report";

import styles from "./reports.module.css";

type ReportTab = "production" | "activity";

export function ReportsPage() {
  const [search, setSearch] = useSearchParams();
  const filters = createMemo(() => reportFiltersQuery());
  const tab = (): ReportTab =>
    search.tab === "activity" ? "activity" : "production";

  return (
    <div class={styles.page}>
      <TabStrip<ReportTab>
        tabs={[
          { id: "production", label: "Producción" },
          { id: "activity", label: "Actividad" },
        ]}
        activeTab={tab()}
        onTabSelect={(id) => setSearch({ tab: id })}
      />
      <Errored
        fallback={(error) => (
          <EmptyState
            title="No se pudo cargar el reporte"
            description={actionErrorMessage(error)}
          />
        )}
      >
        <Loading fallback={<Skeleton height={240} />}>
          <Show
            when={tab() === "activity"}
            fallback={<ProductionReport filters={filters()} />}
          >
            <ActivityReport filters={filters()} />
          </Show>
        </Loading>
      </Errored>
    </div>
  );
}
