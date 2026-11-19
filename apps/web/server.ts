// The production server. `vite build` emits browser assets to dist/client and
// a web-standard request handler to dist/server/server.js; this serves the
// first and delegates everything else to the second.
import { handleRequest } from "./dist/server/server.js";

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

const server = Bun.serve({
  port,
  hostname,

  // Realtime streams stay open indefinitely between events; the hub sweeps
  // stale peers itself, so the socket must not be reaped underneath it.
  idleTimeout: 0,

  async fetch(request) {
    const { pathname } = new URL(request.url);

    const asset = await staticAsset(pathname);

    if (asset) {
      return asset;
    }

    return handleRequest(request);
  },
});

console.log(`Listening on http://${server.hostname}:${server.port}`);
