import type { Kysely } from "kysely";

import {
  encodeRealtimeFrame,
  REALTIME_CLOSE,
  type RealtimeChannelName,
} from "~/contracts/realtime/channel";
import type { AuthSession } from "~/domain/auth/access/session-types";
import type { CommitEffects } from "~/server/platform/database/commit-effects";
import { createLogger } from "~/shared/observability/runtime-logger";

import { type RealtimeChannel, topicOf } from "./channel";
import {
  refuseSocket,
  type RealtimeSockets,
  type SocketUpgrade,
} from "./sockets";

// Sockets older than this close on their next message, so authorization runs
// again when the client reconnects.
const MAX_SOCKET_AGE_MS = 15 * 60_000;

// The close code for a server fault, from RFC 6455.
const INTERNAL_ERROR = 1011;

const logger = createLogger("realtime");

export interface RealtimeConnectRequest {
  channel: string;
  id: string;
  cursor: string | null;
}

export interface RealtimePublisher {
  // The message describes state the executor wrote, so it leaves when that
  // transaction commits and never after a rollback.
  publish(
    executor: Kysely<any>,
    channel: RealtimeChannelName,
    payload: string,
  ): void;
}

export interface RealtimeService extends RealtimePublisher {
  isWatched(channel: RealtimeChannelName, id: string): boolean;
  /**
   * Upgrades the request to a socket on the topic it names. A refusal is a
   * socket closed with the reason's code. The caller supplies the session
   * because middleware already resolved it onto the request context.
   */
  connect: (
    session: AuthSession | null,
    request: RealtimeConnectRequest,
    upgrade: SocketUpgrade,
  ) => Promise<void>;
}

// One service per workspace: its sockets carry only that workspace's topics,
// and its publishers write only to that workspace's store.
//
// Channels resolve on first use: their projectors read runtimes that are built
// with this service as their publisher.
export function createRealtimeService(input: {
  channels: () => readonly RealtimeChannel[];
  effects: CommitEffects;
  sockets: RealtimeSockets;
}): RealtimeService {
  const { sockets } = input;
  let byName: Map<string, RealtimeChannel> | undefined;

  // Sockets whose opening state is still being read, with the frames broadcast
  // meanwhile. They go out after the opening state, so none is lost or
  // reordered.
  const opening = new Map<string, string[]>();

  function channelNamed(name: string): RealtimeChannel | undefined {
    byName ??= new Map(
      input.channels().map((channel) => [channel.name, channel]),
    );

    return byName.get(name);
  }

  function broadcast(channel: RealtimeChannel, payload: string): void {
    const topic = channel.topicOfPayload(payload);

    if (topic === null) {
      return;
    }

    // The writer owns the serialized browser payload.
    const frame = encodeRealtimeFrame({
      data: payload,
      id: channel.cursorOf(payload),
    });
    // clock-boundary: socket age.
    const now = Date.now();

    for (const socket of sockets.onTopic(topic)) {
      const buffered = opening.get(socket.id);
      if (buffered) {
        buffered.push(frame);
      } else if (now - socket.openedAt > MAX_SOCKET_AGE_MS) {
        socket.close(REALTIME_CLOSE.expired, "expired");
      } else {
        socket.send(frame);
      }
    }
  }

  function publish(
    executor: Kysely<any>,
    name: RealtimeChannelName,
    payload: string,
  ): void {
    const channel = channelNamed(name);

    if (!channel) {
      return;
    }

    input.effects.after(executor, () => broadcast(channel, payload));
  }

  async function connect(
    session: AuthSession | null,
    request: RealtimeConnectRequest,
    upgrade: SocketUpgrade,
  ): Promise<void> {
    if (session?.sessionClass !== "app") {
      refuseSocket(upgrade, REALTIME_CLOSE.unauthenticated, "unauthenticated");
      return;
    }

    const entry = channelNamed(request.channel)?.entry(request.id, session);

    if (!entry) {
      refuseSocket(upgrade, REALTIME_CLOSE.notFound, "not found");
      return;
    }

    // Listed before the read, so a broadcast during the read is buffered.
    const socket = sockets.accept(upgrade, entry.topic);
    const buffered: string[] = [];
    opening.set(socket.id, buffered);

    let messages;
    try {
      messages = await entry.open(request.cursor);
    } catch (error: unknown) {
      opening.delete(socket.id);
      logger.error("realtime_open_failed", { topic: entry.topic, error });
      socket.close(INTERNAL_ERROR, "open failed");
      return;
    }

    // Synchronous from here, so no broadcast can land between the opening
    // state and the buffer.
    opening.delete(socket.id);

    if (messages === null) {
      socket.close(REALTIME_CLOSE.notFound, "not found");
      return;
    }

    for (const message of messages) {
      socket.send(encodeRealtimeFrame(message));
    }
    for (const frame of buffered) {
      socket.send(frame);
    }
  }

  return {
    publish,
    isWatched: (channel, id) =>
      sockets.onTopic(topicOf(channel, id)).length > 0,
    connect,
  };
}
