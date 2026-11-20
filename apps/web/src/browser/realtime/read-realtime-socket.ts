import {
  decodeRealtimeFrame,
  REALTIME_CLOSE,
  REALTIME_PING,
  REALTIME_PONG,
  type RealtimeMessage,
} from "~/contracts/realtime/channel";

export type SocketOutcome =
  | { kind: "closed" }
  | { kind: "denied"; code: number }
  | { kind: "failed" };

export interface ReadRealtimeSocketParams {
  // A same-origin path; the reader picks ws or wss from the page.
  path: string;
  signal: AbortSignal;
  onOpen: () => void;
  onMessage: (message: RealtimeMessage) => void;
}

export type ReadRealtimeSocket = (
  params: ReadRealtimeSocketParams,
) => Promise<SocketOutcome>;

// Proxies drop a connection that stays silent for about a minute.
const PING_INTERVAL_MS = 30_000;

const GOING_AWAY = 1001;
const NORMAL = 1000;

// A refusal cannot change on retry; an expiry or a server restart can.
function outcomeOf(code: number): SocketOutcome {
  if (
    code === REALTIME_CLOSE.unauthenticated ||
    code === REALTIME_CLOSE.notFound
  ) {
    return { kind: "denied", code };
  }
  if (
    code === REALTIME_CLOSE.expired ||
    code === NORMAL ||
    code === GOING_AWAY
  ) {
    return { kind: "closed" };
  }
  return { kind: "failed" };
}

function socketUrl(path: string): string {
  const url = new URL(path, location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
}

// Aborts are reported as failures because callers ignore the result on teardown.
export function readRealtimeSocket(
  params: ReadRealtimeSocketParams,
): Promise<SocketOutcome> {
  return new Promise((resolve) => {
    if (params.signal.aborted) {
      resolve({ kind: "failed" });
      return;
    }

    const socket = new WebSocket(socketUrl(params.path));
    let pinger: ReturnType<typeof setInterval> | null = null;

    function finish(outcome: SocketOutcome): void {
      if (pinger !== null) {
        clearInterval(pinger);
        pinger = null;
      }
      params.signal.removeEventListener("abort", abort);
      resolve(outcome);
    }

    function abort(): void {
      socket.close(NORMAL);
      finish({ kind: "failed" });
    }

    params.signal.addEventListener("abort", abort);

    socket.addEventListener("open", () => {
      pinger = setInterval(() => socket.send(REALTIME_PING), PING_INTERVAL_MS);
      params.onOpen();
    });

    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string" || event.data === REALTIME_PONG) {
        return;
      }
      const message = decodeRealtimeFrame(event.data);
      if (message) {
        params.onMessage(message);
      }
    });

    // An error is always followed by a close, which carries the code.
    socket.addEventListener("close", (event) => finish(outcomeOf(event.code)));
  });
}
