import { useAction, useNavigate, useSearchParams } from "@solidjs/router";
import { For, Loading, Show, createMemo, createSignal } from "solid-js";

import { EmptyState } from "~/components/feedback/empty-state/empty";
import { useSnackBar } from "~/components/feedback/snack-bar-manager/use-snack-bar";
import { useAuthenticatedSession } from "~/components/providers/authenticated-session-provider";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { Skeleton } from "~/components/ui/feedback/skeleton";
import { Button } from "~/components/ui/input/button";
import { Select } from "~/components/ui/input/select";
import type { HeldCampaignRecordView } from "~/contracts/campaigns/views";
import { actionErrorMessage } from "~/contracts/errors";
import { hasPermission } from "~/domain/auth/access/rbac";
import {
  campaignAvailabilityQuery,
  campaignsQuery,
  myCampaignBatchQuery,
} from "~/rpc/campaigns/queries";

import {
  drawCampaignBatchMutation,
  markCampaignRecordWorkedMutation,
  releaseCampaignBatchMutation,
} from "./data/mutations";

import styles from "./campaign-work.module.css";

export function CampaignWork() {
  const [search, setSearch] = useSearchParams();
  const campaigns = createMemo(() => campaignsQuery());
  const selected = createMemo(() => {
    const list = campaigns();
    return list.find((campaign) => campaign.id === search.campaign) ?? list[0];
  });

  return (
    <Loading fallback={<Skeleton height={160} />}>
      <Show
        when={selected()}
        fallback={
          <EmptyState
            title="Sin campañas"
            description="Un gerente comercial carga las bases en Configuración, Campañas."
          />
        }
      >
        {(campaign) => (
          <div class={styles.page}>
            <Show when={campaigns().length > 1}>
              <div class={styles.picker}>
                <Select
                  label="Campaña"
                  value={campaign().id}
                  onInput={(event) =>
                    setSearch({ campaign: event.currentTarget.value })
                  }
                >
                  <For each={campaigns()}>
                    {(option) => (
                      <option value={option.id}>{option.name}</option>
                    )}
                  </For>
                </Select>
              </div>
            </Show>
            <CampaignBatch campaignId={campaign().id} />
          </div>
        )}
      </Show>
    </Loading>
  );
}

function CampaignBatch(props: { campaignId: string }) {
  const held = createMemo(() => myCampaignBatchQuery(props.campaignId));

  return (
    <Show
      when={held().length > 0}
      fallback={<DrawPanel campaignId={props.campaignId} />}
    >
      <HeldBatch campaignId={props.campaignId} records={held()} />
    </Show>
  );
}

function DrawPanel(props: { campaignId: string }) {
  const availability = createMemo(() =>
    campaignAvailabilityQuery(props.campaignId),
  );
  const total = () =>
    availability().reduce((sum, segment) => sum + segment.available, 0);
  const draw = useAction(drawCampaignBatchMutation);
  const [segment, setSegment] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string>();

  async function takeBatch(): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      const result = await draw({
        campaignId: props.campaignId,
        ...(segment() ? { segment: segment() } : {}),
      });
      if (!result.ok) {
        setError(result.error.message);
      }
    } catch (caught: unknown) {
      setError(actionErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Show
      when={total() > 0}
      fallback={
        <EmptyState
          title="No quedan empresas por trabajar"
          description="Todas las empresas de esta campaña ya fueron tomadas o trabajadas."
        />
      }
    >
      <section class={styles.draw}>
        <div>
          <h2 class={styles.title}>Toma un lote</h2>
          <p class={styles.hint}>
            Recibes hasta 30 empresas que nadie más está trabajando.
          </p>
        </div>
        <Show when={availability().length > 1}>
          <Select
            label="Segmento"
            value={segment()}
            disabled={busy()}
            onInput={(event) => setSegment(event.currentTarget.value)}
          >
            <option value="">Todos ({total()} disponibles)</option>
            <For each={availability()}>
              {(option) => (
                <option value={option.segment}>
                  {option.segment} ({option.available})
                </option>
              )}
            </For>
          </Select>
        </Show>
        <div class={styles.drawAction}>
          <Button
            type="button"
            loading={busy()}
            disabled={busy()}
            onClick={() => void takeBatch()}
          >
            Tomar lote
          </Button>
        </div>
        <Show when={error()}>
          {(message) => (
            <p class={styles.error} role="alert">
              {message()}
            </p>
          )}
        </Show>
      </section>
    </Show>
  );
}

function HeldBatch(props: {
  campaignId: string;
  records: HeldCampaignRecordView[];
}) {
  const markWorked = useAction(markCampaignRecordWorkedMutation);
  const release = useAction(releaseCampaignBatchMutation);
  const { enqueueErrorSnackBar, enqueueSuccessSnackBar } = useSnackBar();
  const navigate = useNavigate();
  const { currentUser } = useAuthenticatedSession();
  const canOpenCase = () => hasPermission(currentUser(), "case:work");
  const [pendingId, setPendingId] = createSignal<string>();
  const [confirming, setConfirming] = createSignal(false);
  const [releasing, setReleasing] = createSignal(false);

  async function markRecord(recordId: string): Promise<void> {
    setPendingId(recordId);
    try {
      const result = await markWorked(recordId);
      if (!result.ok) {
        enqueueErrorSnackBar(result.error.message);
      }
    } catch (caught: unknown) {
      enqueueErrorSnackBar(actionErrorMessage(caught));
    } finally {
      setPendingId(undefined);
    }
  }

  async function releaseBatch(): Promise<void> {
    setReleasing(true);
    try {
      const result = await release(props.campaignId);
      if (!result.ok) {
        enqueueErrorSnackBar(result.error.message);
        return;
      }
      setConfirming(false);
      enqueueSuccessSnackBar(
        `Devolviste ${result.value.released} empresas a la campaña.`,
      );
    } catch (caught: unknown) {
      enqueueErrorSnackBar(actionErrorMessage(caught));
    } finally {
      setReleasing(false);
    }
  }

  return (
    <section class={styles.batch}>
      <div class={styles.batchHeader}>
        <div>
          <h2 class={styles.title}>Tu lote</h2>
          <p class={styles.hint}>{props.records.length} por trabajar</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setConfirming(true)}
        >
          Devolver pendientes
        </Button>
      </div>

      <ul class={styles.list}>
        <For each={props.records}>
          {(record) => (
            <li class={styles.row}>
              <div class={styles.company}>
                <span class={styles.name}>
                  {record.legalName ?? record.ruc}
                </span>
                <span class={styles.meta}>
                  RUC {record.ruc} · {record.segment}
                </span>
                <Show when={Object.keys(record.facts).length > 0}>
                  <dl class={styles.facts}>
                    <For each={Object.entries(record.facts)}>
                      {(fact) => (
                        <div class={styles.fact}>
                          <dt>{fact[0].replaceAll("_", " ")}</dt>
                          <dd>{fact[1]}</dd>
                        </div>
                      )}
                    </For>
                  </dl>
                </Show>
              </div>
              <div class={styles.rowActions}>
                <Show when={canOpenCase()}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      navigate(
                        `/cases/new?${new URLSearchParams({
                          ruc: record.ruc,
                        }).toString()}`,
                      )
                    }
                  >
                    Abrir caso
                  </Button>
                </Show>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  loading={pendingId() === record.id}
                  disabled={pendingId() !== undefined}
                  onClick={() => void markRecord(record.id)}
                >
                  Trabajado
                </Button>
              </div>
            </li>
          )}
        </For>
      </ul>

      <ConfirmDialog
        isOpen={confirming()}
        title={`¿Devolver ${props.records.length} empresas?`}
        description="Las empresas que no marcaste como trabajadas vuelven a la campaña y otro ejecutivo puede tomarlas."
        confirmLabel="Devolver"
        loading={releasing()}
        onConfirm={() => void releaseBatch()}
        onClose={() => setConfirming(false)}
      />
    </section>
  );
}
