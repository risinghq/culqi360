import type { GpvSnapshotState } from "~/domain/merchant-stats/snapshot";

/** The most lines the browser reads from one GPV report. */
export const MAX_GPV_IMPORT_ROWS = 50_000;

/** Lines the browser sends per staging call. Each call is one transaction on
 * the workspace's Durable Object, which serves nothing else while it runs, so
 * a batch is sized to about 100 ms; the GPV bench measures one batch. */
export const GPV_IMPORT_BATCH_LINES = 500;

/** The columns a sheet's header must hold to be the GPV report. */
export const GPV_REQUIRED_HEADERS = [
  "anomes_vta",
  "identificador_tributario",
  "id_merchant",
  "producto",
  "fecha_venta",
  "gpv_m0",
] as const;

export function isGpvReportHeader(columns: readonly string[]): boolean {
  const present = new Set(columns);
  return GPV_REQUIRED_HEADERS.every((column) => present.has(column));
}

/** A snapshot's settled shape and the blocking issues it waits on. */
export interface GpvSnapshotView {
  snapshotId: string;
  state: GpvSnapshotState;
  cutAt: string;
  issues: readonly {
    id: string;
    type: string;
    detail: string;
    entityKey: string | null;
  }[];
}
