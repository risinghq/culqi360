export const REALTIME_CHANNELS = {
  // An unbounded stream of rows, which is a different shape from one entity's
  // lifecycle and so keeps its own channel.
  eventLogs: "event-logs",

  // Every kind of tracked server work. The kind travels in the subscription id
  // rather than in the channel name, so adding one costs a projector.
  jobs: "jobs",
} as const;

export type RealtimeChannelName =
  (typeof REALTIME_CHANNELS)[keyof typeof REALTIME_CHANNELS];

export interface RealtimeMessage {
  // Present only for resumable channels.
  id?: string;
  data: string;
}

// Close codes in the range WebSocket leaves to applications. A browser cannot
// read the status of a refused handshake, so the server accepts the socket and
// closes it with one of these instead.
export const REALTIME_CLOSE = {
  // Authorization is checked again on reconnect.
  expired: 4000,
  unauthenticated: 4401,
  // The channel is unknown, the id is malformed, or access is denied.
  notFound: 4404,
} as const;

// The client pings an idle socket so proxies keep it open. The server answers
// without reading the frame, so a ping never wakes a hibernating Durable
// Object.
export const REALTIME_PING = "ping";
export const REALTIME_PONG = "pong";

export function realtimeSocketUrl(
  channel: RealtimeChannelName,
  id: string,
  cursor: string | null,
): string {
  const path = `/api/realtime/${channel}/${encodeURIComponent(id)}/socket`;
  return cursor === null
    ? path
    : `${path}?cursor=${encodeURIComponent(cursor)}`;
}

// A frame is the cursor, a newline, then the payload. Payloads are JSON as
// `JSON.stringify` writes it, which holds no raw newline, and a cursor holds
// none either, so the first newline splits them without escaping the payload.
export function encodeRealtimeFrame(message: RealtimeMessage): string {
  return `${message.id ?? ""}\n${message.data}`;
}

export function decodeRealtimeFrame(frame: string): RealtimeMessage | null {
  const split = frame.indexOf("\n");
  if (split < 0) {
    return null;
  }
  const id = frame.slice(0, split);
  const data = frame.slice(split + 1);
  return id === "" ? { data } : { id, data };
}
