// The production server. `vite build` emits browser assets to dist/client and
// a web-standard request handler to dist/server/server.js; this serves the
// first and delegates everything else to the second.
import { handleRequest } from "./dist/server/server.js";
import { REALTIME_PING, REALTIME_PONG } from "./src/contracts/realtime/channel";
import type { SocketUpgradeRequest } from "./src/server/realtime/sockets";

const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOST ?? "0.0.0.0";

const clientRoot = new URL("./dist/client/", import.meta.url);

// Vite writes hashed filenames under assets/, so those are content-addressed.
const IMMUTABLE_ASSET_PREFIX = "/assets/";

// The prerendered document shell goes through the handler like every other
// page, so the middleware sets its security headers.
const DOCUMENT_PATHS = new Set(["/", "/index.html"]);

async function staticAsset(pathname: string): Promise<Response | null> {
  if (DOCUMENT_PATHS.has(pathname) || pathname.includes("..")) {
    return null;
  }

  const file = Bun.file(new URL(`.${pathname}`, clientRoot));

  if (!(await file.exists())) {
    return null;
  }

  return new Response(file, {
    headers: {
      "Cache-Control": pathname.startsWith(IMMUTABLE_ASSET_PREFIX)
        ? "public, max-age=31536000, immutable"
        : "public, max-age=0, must-revalidate",
    },
  });
}

function isSocketHandshake(request: Request): boolean {
  return request.headers.get("upgrade")?.toLowerCase() === "websocket";
}

const server = Bun.serve<SocketUpgradeRequest>({
  port,
  hostname,

  async fetch(request, bunServer) {
    const { pathname } = new URL(request.url);

    const asset = await staticAsset(pathname);

    if (asset) {
      return asset;
    }

    if (!isSocketHandshake(request)) {
      return handleRequest(request);
    }

    // The route upgrades the connection through this; Bun then answers the
    // handshake itself, so the route's response is dropped.
    let upgraded = false;
    const socketUpgrade = (socket: SocketUpgradeRequest) => {
      upgraded = bunServer.upgrade(request, { data: socket });
      if (!upgraded) {
        socket.closed();
      }
    };
    const response = await handleRequest(request, {
      event: { locals: { socketUpgrade } },
    });
    return upgraded ? undefined : response;
  },

  websocket: {
    open(ws) {
      ws.data.open({
        send: (frame) => ws.send(frame),
        close: (code, reason) => ws.close(code, reason),
      });
    },
    message(ws, message) {
      if (message === REALTIME_PING) {
        ws.send(REALTIME_PONG);
      }
    },
    close(ws) {
      ws.data.closed();
    },
  },
});

console.log(`Listening on http://${server.hostname}:${server.port}`);
