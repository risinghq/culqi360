import { useAction } from "@solidjs/router";
import {
  createSignal,
  Errored,
  For,
  Loading,
  Match,
  Show,
  Switch,
  createMemo,
} from "solid-js";

import { createActionPending } from "~/browser/ui/action-in-flight";
import { actionErrorMessage } from "~/contracts/errors";
import type { GpvSnapshotView } from "~/contracts/merchant-stats/imports";
import { formatAppDateTime } from "~/domain/time/app-time";
import { WidgetCardShell } from "~/features/widgets/widget-card-shell";
import { WidgetSkeleton } from "~/features/widgets/widget-skeleton";
import { gpvSnapshotQuery } from "~/rpc/merchant-stats/gpv-snapshot";

import { resolveGpvImportIssueMutation } from "../data/mutations";

import styles from "./upload-report.module.css";

type IssueResolution =
  | "keep_previous"
  | "accept_candidate"
  | "exclude_candidate"
  | "reject_snapshot";

// The boundaries live here so the card below only ever sees a settled view.
export function ImportStatus(props: { snapshotId: string }) {
  const snapshot = createMemo(() => gpvSnapshotQuery(props.snapshotId));

  return (
    <Loading fallback={<WidgetSkeleton />}>
      <Errored
        fallback={
          <WidgetCardShell title="Importación GPV" status="error">
            <span />
          </WidgetCardShell>
        }
      >
        <ImportSnapshotCard view={snapshot()} />
      </Errored>
    </Loading>
  );
}

function ImportSnapshotCard(props: { view: GpvSnapshotView }) {
  const resolveIssue = useAction(resolveGpvImportIssueMutation);
  const resolving = createActionPending(resolveGpvImportIssueMutation);
  const [resolutionError, setResolutionError] = createSignal<unknown>(null);

  async function submitDecision(
    issueId: string,
    resolution: IssueResolution,
  ): Promise<void> {
    setResolutionError(null);

    try {
      await resolveIssue({ issueId, resolution });
    } catch (caught) {
      setResolutionError(caught);
    }
  }

  return (
    <WidgetCardShell
      title="Importación GPV"
      action={
        <span class={styles.status}>
          Corte {formatAppDateTime(new Date(props.view.cutAt))}
        </span>
      }
    >
      <div class={styles.panel}>
        <Show when={resolutionError()}>
          {(error) => (
            <p class={styles.statusError}>{actionErrorMessage(error())}</p>
          )}
        </Show>

        <Switch>
          <Match when={props.view.state === "staging"}>
            <p class={styles.statusError}>
              La importación quedó incompleta. Vuelve a subir el archivo.
            </p>
          </Match>

          <Match when={props.view.state === "needs_review"}>
            <p class={styles.statusError}>
              Esta actualización necesita una decisión antes de publicarse.
            </p>

            <For each={props.view.issues}>
              {(issue) => (
                <div class={styles.reviewIssue}>
                  <p>{issue.detail}</p>

                  <div class={styles.reviewActions}>
                    <Show when={issue.type !== "row_rejected"}>
                      <DecisionButton
                        disabled={resolving()}
                        onClick={() =>
                          void submitDecision(issue.id, "keep_previous")
                        }
                      >
                        Mantener anterior
                      </DecisionButton>

                      <DecisionButton
                        disabled={resolving()}
                        onClick={() =>
                          void submitDecision(issue.id, "accept_candidate")
                        }
                      >
                        {issue.type === "placement_missing"
                          ? "Aceptar ausencia"
                          : "Usar nuevo"}
                      </DecisionButton>
                    </Show>

                    <Show when={issue.type === "row_rejected"}>
                      <DecisionButton
                        disabled={resolving()}
                        onClick={() =>
                          void submitDecision(issue.id, "exclude_candidate")
                        }
                      >
                        Omitir fila inválida
                      </DecisionButton>
                    </Show>

                    <DecisionButton
                      disabled={resolving()}
                      onClick={() =>
                        void submitDecision(issue.id, "reject_snapshot")
                      }
                    >
                      Descartar actualización
                    </DecisionButton>
                  </div>
                </div>
              )}
            </For>
          </Match>

          <Match when={props.view.state === "active"}>
            <p class={styles.statusDone}>La actualización está publicada.</p>
          </Match>

          <Match when={props.view.state === "ready"}>
            <p class={styles.statusDone}>
              La actualización está lista para publicarse.
            </p>
          </Match>

          <Match when={props.view.state === "superseded"}>
            <p class={styles.status}>
              Esta actualización fue reemplazada por una más reciente.
            </p>
          </Match>

          <Match when={props.view.state === "rejected"}>
            <p class={styles.status}>La actualización fue descartada.</p>
          </Match>
        </Switch>
      </div>
    </WidgetCardShell>
  );
}

function DecisionButton(props: {
  children: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      class={styles.close}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}
