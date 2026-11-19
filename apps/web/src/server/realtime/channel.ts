import type {
  RealtimeChannelName,
  RealtimeMessage,
} from "~/contracts/realtime/channel";
import type { AuthSession } from "~/domain/auth/access/session-types";

export interface RealtimeChannelConfig<TId extends string> {
  name: RealtimeChannelName;
  parseId: (raw: string) => TId | null;

  // Authorizes the subscription and returns its initial state in one read.
  // Returning null hides whether the id is missing or merely inaccessible.
  open: (
    session: AuthSession,
    id: TId,
    cursor: string | null,
  ) => Promise<RealtimeMessage[] | null>;

  topicIdOfPayload: (payload: string) => string | null;

  // Used by resumable channels as both the SSE event id and reconnect cursor.
  cursorOf?: (payload: string) => string | undefined;
}

export interface RealtimeChannel {
  readonly name: RealtimeChannelName;
  topicOfPayload: (payload: string) => string | null;
  cursorOf: (payload: string) => string | undefined;
  entry: (
    rawId: string,
    session: AuthSession,
  ) => {
    topic: string;
    open: (cursor: string | null) => Promise<RealtimeMessage[] | null>;
  } | null;
}

export function topicOf(name: string, id: string): string {
  return `${name}.${id}`;
}

export function defineRealtimeChannel<TId extends string>(
  config: RealtimeChannelConfig<TId>,
): RealtimeChannel {
  return {
    name: config.name,

    topicOfPayload: (payload) => {
      const topicId = config.topicIdOfPayload(payload);

      return topicId === null ? null : topicOf(config.name, topicId);
    },

    cursorOf: (payload) => config.cursorOf?.(payload),

    entry: (rawId, session) => {
      const id = config.parseId(rawId);

      if (id === null) {
        return null;
      }

      return {
        topic: topicOf(config.name, id),
        open: (cursor) => config.open(session, id, cursor),
      };
    },
  };
}
