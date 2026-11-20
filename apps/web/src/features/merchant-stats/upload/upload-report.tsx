import { useAction, useNavigate } from "@solidjs/router";
import { createSignal, Match, Show, Switch } from "solid-js";

import { readTableFile } from "~/browser/files/table";
import { useSnackBar } from "~/components/feedback/snack-bar-manager/use-snack-bar";
import { FileDropzone } from "~/components/ui/input/file-dropzone";
import { InputHint } from "~/components/ui/input/input-hint";
import { InputLabel } from "~/components/ui/input/input-label";
import { TextInput } from "~/components/ui/input/text-input";
import { actionErrorMessage } from "~/contracts/errors";
import {
  GPV_IMPORT_BATCH_LINES,
  isGpvReportHeader,
  MAX_GPV_IMPORT_ROWS,
} from "~/contracts/merchant-stats/imports";
import { openGpvImport, stageGpvImport } from "~/rpc/merchant-stats/imports";
import { sha256Hex } from "~/shared/sha256";
import type { TableBody } from "~/shared/table";

import { closeGpvImportMutation } from "../data/mutations";
import { formatInteger } from "../format";

import styles from "./upload-report.module.css";

type UploadPhase =
  | { kind: "idle" }
  | { kind: "reading" }
  | { kind: "staging"; staged: number; total: number }
  | { kind: "closing" };

export function UploadReport() {
  const navigate = useNavigate();
  const close = useAction(closeGpvImportMutation);
  const { enqueueErrorSnackBar } = useSnackBar();

  const [cutAt, setCutAt] = createSignal("");
  const [phase, setPhase] = createSignal<UploadPhase>({ kind: "idle" });
  const [errorMessage, setErrorMessage] = createSignal<string>();

  const isUploading = () => phase().kind !== "idle";

  function showImport(snapshotId: string): void {
    navigate(`/dashboards/merchant-gpv/imports/${snapshotId}`);
  }

  // Batches run in file order. A browser that stops midway leaves the
  // snapshot staging; the next open drops it.
  async function stageBatches(
    snapshotId: string,
    table: TableBody,
  ): Promise<void> {
    const { columns, lines } = table;
    const total = lines.length;

    for (let at = 0; at < total; at += GPV_IMPORT_BATCH_LINES) {
      setPhase({ kind: "staging", staged: at, total });
      // eslint-disable-next-line no-await-in-loop
      await stageGpvImport({
        snapshotId,
        table: { columns, lines: lines.slice(at, at + GPV_IMPORT_BATCH_LINES) },
      });
    }
  }

  async function importFile(file: File): Promise<void> {
    setPhase({ kind: "reading" });
    const read = await readTableFile(file, {
      isHeader: isGpvReportHeader,
      maxLines: MAX_GPV_IMPORT_ROWS,
      missingHeader: "El archivo no es el reporte GPV.",
    });
    if (!read.ok) {
      setErrorMessage(read.message);
      return;
    }

    const opened = await openGpvImport({
      fileName: file.name,
      cutAt: cutAt() || null,
      contentSha256: await sha256Hex(await file.arrayBuffer()),
    });
    if (!opened.ok) {
      setErrorMessage(opened.error.message);
      return;
    }

    const { snapshotId, duplicate } = opened.value;
    if (!duplicate) {
      await stageBatches(snapshotId, read.table);
      setPhase({ kind: "closing" });
      await close({ snapshotId });
    }
    showImport(snapshotId);
  }

  async function uploadFile(file: File): Promise<void> {
    if (isUploading()) {
      return;
    }

    setErrorMessage(undefined);

    try {
      await importFile(file);
    } catch (error: unknown) {
      const message = actionErrorMessage(error);

      setErrorMessage(message);
      enqueueErrorSnackBar(message);
    } finally {
      setPhase({ kind: "idle" });
    }
  }

  return (
    <div class={styles.panel}>
      <FileDropzone
        accept=".xlsx"
        disabled={isUploading()}
        onFiles={(files) => {
          const file = files[0];

          if (file) {
            void uploadFile(file);
          }
        }}
      >
        {(state) => (
          <div class={[styles.dropzone, state.dragging && styles.dragging]}>
            <p class={styles.dropTitle}>
              Arrastra el reporte GPV (.xlsx) o haz clic para elegir
            </p>
            <p class={styles.dropHint}>
              El reporte del dealer, tal como sale del sistema de Culqi.
            </p>
          </div>
        )}
      </FileDropzone>

      <div class={styles.cutField}>
        <InputLabel for="gpv-cut-at">Fecha de corte</InputLabel>
        <TextInput
          id="gpv-cut-at"
          type="datetime-local"
          value={cutAt()}
          disabled={isUploading()}
          onChange={setCutAt}
        />
        <InputHint>
          Se lee del nombre del archivo. Indícala solo si fue renombrado.
        </InputHint>
      </div>

      <Switch>
        <Match when={phase().kind === "reading"}>
          <p class={styles.status}>Leyendo el archivo…</p>
        </Match>

        <Match
          when={(() => {
            const current = phase();
            return current.kind === "staging" ? current : false;
          })()}
        >
          {(staging) => <StageProgress {...staging()} />}
        </Match>

        <Match when={phase().kind === "closing"}>
          <p class={styles.status}>Revisando la actualización…</p>
        </Match>
      </Switch>

      <Show when={errorMessage()}>
        {(message) => (
          <p class={styles.statusError} role="alert">
            {message()}
          </p>
        )}
      </Show>
    </div>
  );
}

function StageProgress(props: { staged: number; total: number }) {
  return (
    <div>
      <p class={styles.status}>
        Cargando {formatInteger(props.staged)} de {formatInteger(props.total)}{" "}
        filas…
      </p>

      <div class={styles.bar}>
        <div
          class={styles.barFill}
          style={{
            width: `${props.total ? (props.staged / props.total) * 100 : 0}%`,
          }}
        />
      </div>
    </div>
  );
}
