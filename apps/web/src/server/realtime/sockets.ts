// The WebSocket transport of the realtime service. The Solid SSR handler
// rebuilds the response a route returns, so a 101 cannot travel back through
// it: the server that received the request completes the handshake itself,
// through a `SocketUpgrade` it sets on the request event's locals.

// The server side of one open socket, as the host hands it over.
export interface SocketPeer {
  send(frame: string): void;
  close(code: number, reason: string): void;
}

export interface SocketUpgradeRequest {
  // The topic the socket is listed under. A refused socket has none.
  topic: string | null;
  id: string;
  openedAt: number;
  // Called once the connection is upgraded, which a host may do after the
  // request returns.
  open(peer: SocketPeer): void;
  // Called when the socket closes, on a host that keeps sockets in memory.
  closed(): void;
}

export type SocketUpgrade = (request: SocketUpgradeRequest) => void;

export interface RealtimeSocket {
  readonly id: string;
  // Wall-clock milliseconds, so the age survives a Durable Object waking from
  // hibernation in another process.
  readonly openedAt: number;
  send(frame: string): void;
  close(code: number, reason: string): void;
}

// The open sockets of one workspace, by topic. The host owns them: a Durable
// Object lists its hibernating sockets, a Bun process holds them in memory.
export interface RealtimeSockets {
  accept(upgrade: SocketUpgrade, topic: string): RealtimeSocket;
  onTopic(topic: string): readonly RealtimeSocket[];
}

// Upgrades the request and returns its socket at once. Frames sent before the
// host opens the connection queue in order, so the caller can send the opening
// state in the same step that accepts.
export function upgradeSocket(
  upgrade: SocketUpgrade,
  topic: string | null,
  closed: () => void,
): RealtimeSocket {
  let peer: SocketPeer | null = null;
  let queued: string[] = [];
  let closing: { code: number; reason: string } | null = null;
  const socket: RealtimeSocket = {
    id: crypto.randomUUID(),
    // clock-boundary: socket age. Compared to the wall clock at broadcast.
    openedAt: Date.now(),
    send(frame) {
      if (peer) {
        peer.send(frame);
      } else if (!closing) {
        queued.push(frame);
      }
    },
    close(code, reason) {
      if (peer) {
        peer.close(code, reason);
      } else {
        closing ??= { code, reason };
      }
    },
  };
  upgrade({
    topic,
    id: socket.id,
    openedAt: socket.openedAt,
    open(opened) {
      peer = opened;
      for (const frame of queued) {
        opened.send(frame);
      }
      queued = [];
      if (closing) {
        opened.close(closing.code, closing.reason);
      }
    },
    closed,
  });
  return socket;
}

// A browser cannot read why a handshake failed, so a refusal is a socket that
// closes with the reason's code.
export function refuseSocket(
  upgrade: SocketUpgrade,
  code: number,
  reason: string,
): void {
  upgradeSocket(upgrade, null, () => {}).close(code, reason);
}

export interface MemorySockets extends RealtimeSockets {
  closeAll(code: number, reason: string): void;
}

export function createMemorySockets(): MemorySockets {
  const byTopic = new Map<string, Set<RealtimeSocket>>();

  function leave(topic: string, socket: RealtimeSocket): void {
    const sockets = byTopic.get(topic);
    sockets?.delete(socket);
    if (sockets?.size === 0) {
      byTopic.delete(topic);
    }
  }

  return {
    accept(upgrade, topic) {
      const socket = upgradeSocket(upgrade, topic, () => leave(topic, socket));
      let sockets = byTopic.get(topic);
      if (!sockets) {
        sockets = new Set();
        byTopic.set(topic, sockets);
      }
      sockets.add(socket);
      return socket;
    },
    onTopic: (topic) => [...(byTopic.get(topic) ?? [])],
    closeAll(code, reason) {
      for (const sockets of byTopic.values()) {
        for (const socket of sockets) {
          socket.close(code, reason);
        }
      }
      byTopic.clear();
    },
  };
}
