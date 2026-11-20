// Realtime sockets on the Vite dev server. Vite answers only its own HMR
// upgrades, so this hands realtime handshakes to the Solid request handler the
// way server.ts does in production, and lets `ws` complete them.
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

import type { Plugin, ViteDevServer } from "vite";
import { WebSocketServer } from "ws";

import { REALTIME_PING, REALTIME_PONG } from "./src/contracts/realtime/channel";
import type { SocketUpgradeRequest } from "./src/server/realtime/sockets";

// The Solid plugin's dev handler module.
const SSR_HANDLER_ID = "virtual:solid-ssr-handler";
const SOCKET_PATH = /^\/api\/realtime\/[^/]+\/[^/]+\/socket$/;

type HandleRequest = (
  request: Request,
  options: { event: { locals: Record<string, unknown> } },
) => Promise<Response>;

function webRequest(message: IncomingMessage): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(message.headers)) {
    if (typeof value === "string") headers.set(name, value);
    else if (value) for (const item of value) headers.append(name, item);
  }
  return new Request(`http://${message.headers.host}${message.url}`, {
    headers,
  });
}

function writeResponse(socket: Duplex, response: Response): void {
  socket.end(
    `HTTP/1.1 ${response.status} ${response.statusText}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
}

async function upgrade(
  server: ViteDevServer,
  sockets: WebSocketServer,
  message: IncomingMessage,
  head: Buffer,
  socket: Duplex,
): Promise<void> {
  const runner = (server.environments.ssr as { runner?: unknown }).runner as {
    import(id: string): Promise<{ handleRequest: HandleRequest }>;
  };
  const { handleRequest } = await runner.import(SSR_HANDLER_ID);

  let upgraded = false;
  const socketUpgrade = (request: SocketUpgradeRequest) => {
    upgraded = true;
    sockets.handleUpgrade(message, socket, head, (ws) => {
      ws.on("message", (data) => {
        if (String(data) === REALTIME_PING) ws.send(REALTIME_PONG);
      });
      ws.on("close", () => request.closed());
      request.open({
        send: (frame) => ws.send(frame),
        close: (code, reason) => ws.close(code, reason),
      });
    });
  };
  const response = await handleRequest(webRequest(message), {
    event: { locals: { socketUpgrade } },
  });
  if (!upgraded) writeResponse(socket, response);
}

export function devSocketsPlugin(): Plugin {
  return {
    name: "work360:dev-sockets",
    apply: "serve",
    configureServer(server) {
      const sockets = new WebSocketServer({ noServer: true });
      server.httpServer?.on("upgrade", (message, socket, head) => {
        const { pathname } = new URL(message.url ?? "/", "http://dev");
        if (!SOCKET_PATH.test(pathname)) return;
        upgrade(server, sockets, message, head, socket).catch((error) => {
          server.config.logger.error(`realtime socket: ${String(error)}`);
          socket.destroy();
        });
      });
    },
  };
}
