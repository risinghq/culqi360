import { useAction } from "@solidjs/router";
import { For, Loading, Show, createMemo, createSignal } from "solid-js";

import { SettingsSection } from "~/components/settings/SettingsSection";
import { Button } from "~/components/ui/input/button";
import { FileInput } from "~/components/ui/input/file-input";
import { Input } from "~/components/ui/input/input";
import type { CampaignImportView } from "~/contracts/campaigns/views";
import { actionErrorMessage } from "~/contracts/errors";
import { campaignsQuery } from "~/rpc/campaigns/queries";

import { importCampaignFileMutation } from "./data/mutations";

import styles from "./campaign-import-section.module.css";

const SHOWN_REJECTIONS = 50;

export function CampaignImportSection() {
  const campaigns = createMemo(() => campaignsQuery());
  const importFile = useAction(importCampaignFileMutation);
  const [campaignName, setCampaignName] = createSignal("");
  const [segmentColumn, setSegmentColumn] = createSignal("");
  const [file, setFile] = createSignal<File | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string>();
  const [report, setReport] = createSignal<{
    campaignName: string;
    result: CampaignImportView;
  }>();

  const ready = () =>
    campaignName().trim() !== "" &&
    segmentColumn().trim() !== "" &&
    file() !== null;

  async function submit(): Promise<void> {
    const selected = file();
    if (!selected || !ready()) {
      return;
    }
    const form = new FormData();
    form.append("file", selected);
    form.append("campaignName", campaignName());
    form.append("segmentColumn", segmentColumn());

    setBusy(true);
    setError(undefined);
    setReport(undefined);
    try {
      const result = await importFile(form);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setReport({ campaignName: campaignName().trim(), result: result.value });
    } catch (caught: unknown) {
      setError(actionErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsSection
      title="Campañas"
      description="Carga una base de empresas en CSV o Excel. Los ejecutivos la trabajan por lotes desde Campañas."
    >
      <form
        class={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Input
          label="Campaña"
          list="campaign-names"
          value={campaignName()}
          disabled={busy()}
          hint="Usa el nombre de una campaña existente para actualizar sus datos."
          onInput={(event) => setCampaignName(event.currentTarget.value)}
        />
        <Loading fallback={null}>
          <datalist id="campaign-names">
            <For each={campaigns()}>
              {(campaign) => (
                <option value={campaign.name}>{campaign.name}</option>
              )}
            </For>
          </datalist>
        </Loading>

        <Input
          label="Columna de segmento"
          value={segmentColumn()}
          disabled={busy()}
          hint="El encabezado que agrupa las empresas, por ejemplo origen."
          onInput={(event) => setSegmentColumn(event.currentTarget.value)}
        />

        <FileInput
          label="Archivo"
          accept=".csv,.xlsx"
          disabled={busy()}
          onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)}
        />

        <div class={styles.actions}>
          <Button type="submit" loading={busy()} disabled={busy() || !ready()}>
            Cargar base
          </Button>
        </div>

        <Show when={error()}>
          {(message) => (
            <p class={styles.error} role="alert">
              {message()}
            </p>
          )}
        </Show>

        <Show when={report()}>
          {(done) => (
            <div class={styles.report} role="status">
              <p class={styles.done}>
                Se cargaron {done().result.imported} empresas en{" "}
                {done().campaignName}.
              </p>
              <Show when={done().result.rejected.length > 0}>
                <p class={styles.hint}>
                  {done().result.rejected.length} filas no se cargaron:
                </p>
                <ul class={styles.rejected}>
                  <For each={done().result.rejected.slice(0, SHOWN_REJECTIONS)}>
                    {(row) => (
                      <li>
                        Línea {row.line}: {row.message}
                      </li>
                    )}
                  </For>
                </ul>
                <Show when={done().result.rejected.length > SHOWN_REJECTIONS}>
                  <p class={styles.hint}>
                    y {done().result.rejected.length - SHOWN_REJECTIONS} más.
                  </p>
                </Show>
              </Show>
            </div>
          )}
        </Show>
      </form>
    </SettingsSection>
  );
}
