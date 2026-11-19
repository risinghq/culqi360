import type { Kysely } from "kysely";

import type { RealtimeChannelName } from "~/contracts/realtime/channel";
import type { AuthSession } from "~/domain/auth/access/session-types";
import type { CommitEffects } from "~/server/platform/database/commit-effects";
import { Err, Ok, type Result } from "~/shared/result";

import { type RealtimeChannel, topicOf } from "./channel";
import { openRealtimeStream } from "./stream";
import { TopicHub } from "./topic-hub";

// Keep idle streams alive through proxies.
const PING_INTERVAL_MS = 20_000;

// Force periodic reconnects so authorization is checked again.
const MAX_STREAM_AGE_MS = 15 * 60_000;

export type RealtimeOpenError = "unauthenticated" | "not_found";

export interface RealtimeOpenRequest {
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
  stop(): void;
  /**
   * The caller supplies the session because middleware already resolved it onto
   * the request context; resolving it again here would drag the request event
   * through the whole subsystem.
   */
  openStream: (
    session: AuthSession | null,
    request: RealtimeOpenRequest,
  ) => Promise<Result<Response, RealtimeOpenError>>;
}

// One service per workspace: its hub only holds that workspace's streams, and
// its publishers write only to that workspace's store.
//
// Channels resolve on first use: their projectors read runtimes that are built
// with this service as their publisher.
export function createRealtimeService(input: {
  channels: () => readonly RealtimeChannel[];
  effects: CommitEffects;
}): RealtimeService {
  const hub = new TopicHub();
  let byName: Map<string, RealtimeChannel> | undefined;
  let sweepTimer: ReturnType<typeof setInterval> | null = null;

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
    hub.broadcast(topic, { data: payload, id: channel.cursorOf(payload) });
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

  function ensureSweep(): void {
    if (sweepTimer !== null) {
      return;
    }

    sweepTimer = setInterval(
      () => hub.sweep(performance.now(), MAX_STREAM_AGE_MS),
      PING_INTERVAL_MS,
    );
    sweepTimer.unref?.();
  }

  function stop(): void {
    if (sweepTimer !== null) {
      clearInterval(sweepTimer);
      sweepTimer = null;
    }

    hub.closeAll();
  }

  async function openStream(
    session: AuthSession | null,
    request: RealtimeOpenRequest,
  ): Promise<Result<Response, RealtimeOpenError>> {
    if (!session || session.sessionClass !== "app") {
      return Err("unauthenticated");
    }

    const channel = channelNamed(request.channel);
    const entry = channel?.entry(request.id, session);

    if (!entry) {
      return Err("not_found");
    }

    ensureSweep();
    const stream = await openRealtimeStream(hub, entry, request.cursor);

    return stream ? Ok(stream) : Err("not_found");
  }

  return {
    publish,
    isWatched: (channel, id) => hub.isWatched(topicOf(channel, id)),
    stop,
    openStream,
  };
}
