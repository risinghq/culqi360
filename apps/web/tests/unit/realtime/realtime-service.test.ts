import { makeAuthSession } from "@tests/support/unit/factories";
import {
  DummyDriver,
  Kysely,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
} from "kysely";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  decodeRealtimeFrame,
  REALTIME_CHANNELS,
  REALTIME_CLOSE,
  type RealtimeMessage,
} from "~/contracts/realtime/channel";
import { CommitEffects } from "~/server/platform/database/commit-effects";
import { defineRealtimeChannel } from "~/server/realtime/channel";
import { createRealtimeService } from "~/server/realtime/runtime";
import {
  createMemorySockets,
  type SocketUpgrade,
  type SocketUpgradeRequest,
} from "~/server/realtime/sockets";

// Outside a transaction, so a publish broadcasts at once.
const executor = new Kysely<any>({
  dialect: {
    createAdapter: () => new SqliteAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (db) => new SqliteIntrospector(db),
    createQueryCompiler: () => new SqliteQueryCompiler(),
  },
});

const session = makeAuthSession({ role: "admin" });

interface Opening {
  read: () => Promise<RealtimeMessage[] | null>;
}

// A jobs channel whose opening read the test controls.
function jobsService(opening: Opening = { read: async () => [] }) {
  const sockets = createMemorySockets();
  const service = createRealtimeService({
    channels: () => [
      defineRealtimeChannel({
        name: REALTIME_CHANNELS.jobs,
        parseId: (raw) => (raw.startsWith("job-") ? raw : null),
        open: () => opening.read(),
        topicIdOfPayload: (payload) => payload.split(":")[0] ?? null,
        cursorOf: (payload) => `cursor-${payload}`,
      }),
    ],
    effects: new CommitEffects(),
    sockets,
  });
  return { service, sockets };
}

// A client socket on a host that opens the connection as soon as it upgrades,
// recording what the server sends and how it closes.
function client() {
  const frames: (RealtimeMessage | null)[] = [];
  let closed: number | null = null;
  let request: SocketUpgradeRequest | null = null;
  const upgrade: SocketUpgrade = (upgraded) => {
    request = upgraded;
    upgraded.open({
      send: (frame) => frames.push(decodeRealtimeFrame(frame)),
      close: (code) => {
        closed = code;
        upgraded.closed();
      },
    });
  };
  return {
    upgrade,
    frames,
    closedWith: () => closed,
    disconnect: () => request?.closed(),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("realtime service", () => {
  it("closes a socket without a signed-in session as unauthenticated", async () => {
    const { service } = jobsService();
    const socket = client();

    await service.connect(
      null,
      { channel: "jobs", id: "job-1", cursor: null },
      socket.upgrade,
    );

    expect(socket.closedWith()).toBe(REALTIME_CLOSE.unauthenticated);
  });

  it("closes an unknown channel, a bad id and a denied topic as not found", async () => {
    const { service } = jobsService({ read: async () => null });

    for (const request of [
      { channel: "nope", id: "job-1" },
      { channel: "jobs", id: "x" },
      { channel: "jobs", id: "job-1" },
    ]) {
      const socket = client();
      // eslint-disable-next-line no-await-in-loop
      await service.connect(
        session,
        { ...request, cursor: null },
        socket.upgrade,
      );
      expect(socket.closedWith()).toBe(REALTIME_CLOSE.notFound);
    }
    expect(service.isWatched(REALTIME_CHANNELS.jobs, "job-1")).toBe(false);
  });

  // The window between listing the socket and finishing the read is where a
  // message could be lost or overtake the state it follows.
  it("sends a broadcast that lands during the opening read after that read", async () => {
    const read = Promise.withResolvers<RealtimeMessage[]>();
    const { service } = jobsService({ read: () => read.promise });
    const socket = client();

    const connecting = service.connect(
      session,
      { channel: "jobs", id: "job-1", cursor: null },
      socket.upgrade,
    );
    service.publish(executor, REALTIME_CHANNELS.jobs, "job-1:late");
    read.resolve([{ id: "cursor-0", data: "state" }]);
    await connecting;

    expect(socket.frames).toEqual([
      { id: "cursor-0", data: "state" },
      { id: "cursor-job-1:late", data: "job-1:late" },
    ]);
  });

  it("broadcasts only to the topic a payload names", async () => {
    const { service } = jobsService();
    const watching = client();
    const other = client();

    await service.connect(
      session,
      { channel: "jobs", id: "job-1", cursor: null },
      watching.upgrade,
    );
    await service.connect(
      session,
      { channel: "jobs", id: "job-2", cursor: null },
      other.upgrade,
    );
    service.publish(executor, REALTIME_CHANNELS.jobs, "job-1:done");

    expect(watching.frames).toHaveLength(1);
    expect(other.frames).toEqual([]);
  });

  it("closes a socket older than its age cap at the next broadcast", async () => {
    vi.useFakeTimers();
    const { service } = jobsService();
    const socket = client();

    await service.connect(
      session,
      { channel: "jobs", id: "job-1", cursor: null },
      socket.upgrade,
    );
    vi.advanceTimersByTime(15 * 60_000 + 1);
    service.publish(executor, REALTIME_CHANNELS.jobs, "job-1:late");

    expect(socket.frames).toEqual([]);
    expect(socket.closedWith()).toBe(REALTIME_CLOSE.expired);
    expect(service.isWatched(REALTIME_CHANNELS.jobs, "job-1")).toBe(false);
  });

  it("reports a topic watched until its last socket leaves", async () => {
    const { service } = jobsService();
    const socket = client();

    await service.connect(
      session,
      { channel: "jobs", id: "job-1", cursor: null },
      socket.upgrade,
    );
    expect(service.isWatched(REALTIME_CHANNELS.jobs, "job-1")).toBe(true);

    socket.disconnect();
    expect(service.isWatched(REALTIME_CHANNELS.jobs, "job-1")).toBe(false);
  });

  it("closes the socket as a server fault when the opening read throws", async () => {
    const { service } = jobsService({
      read: () => Promise.reject(new Error("store down")),
    });
    const socket = client();

    await service.connect(
      session,
      { channel: "jobs", id: "job-1", cursor: null },
      socket.upgrade,
    );

    expect(socket.closedWith()).toBe(1011);
  });

  it("closes every socket when the host stops", async () => {
    const { service, sockets } = jobsService();
    const socket = client();

    await service.connect(
      session,
      { channel: "jobs", id: "job-1", cursor: null },
      socket.upgrade,
    );
    sockets.closeAll(1001, "server stopping");

    expect(socket.closedWith()).toBe(1001);
    expect(service.isWatched(REALTIME_CHANNELS.jobs, "job-1")).toBe(false);
  });
});
