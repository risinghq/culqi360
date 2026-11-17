import { Show } from "solid-js";

import Phone from "~/components/icons/phone";
import { Button } from "~/components/ui/input/button";
import type { CallHandoffRequest } from "~/contracts/calls";

import { createCallHandoff, type CallHandoffState } from "./call-handoff";

import styles from "./call-with-extension.module.css";

function failureOf(state: CallHandoffState) {
  return "reason" in state ? state : undefined;
}

export function CallWithExtension(props: { request: CallHandoffRequest }) {
  const handoff = createCallHandoff(() => props.request);

  return (
    <div class={styles.root}>
      <Button
        variant="secondary"
        size="sm"
        loading={handoff.state().phase === "pending"}
        onClick={() => void handoff.start()}
      >
        <Phone size={14} />
        Llamar con la extensión
      </Button>

      <Show when={handoff.state().phase === "handed-off"}>
        <p class={styles.success} role="status">
          Llamada enviada a la extensión. Iníciala desde su panel.
        </p>
      </Show>

      <Show when={failureOf(handoff.state())}>
        {(failure) => (
          <p class={styles.failure} role="alert">
            {failure().phase === "unreachable"
              ? "No se encontró la extensión. Instálala o actívala en este navegador e inténtalo de nuevo."
              : "No se pudo enviar la llamada."}
            <span class={styles.detail}>{failure().reason}</span>
          </p>
        )}
      </Show>
    </div>
  );
}
