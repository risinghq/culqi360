// How the server treats a request. A page request gets the static shell: the
// browser decides navigation, so the server reads no session for it. Every
// other class reaches application code and resolves the session first.
export type RequestClass =
  | "machine"
  | "public_api"
  | "realtime_socket"
  | "api"
  | "server_function"
  | "page";

const MACHINE_PREFIX = "/api/webhooks/";
const PUBLIC_API_PREFIX = "/api/auth";
// A browser cannot read the status of a refused WebSocket handshake, so the
// socket route authenticates its caller and closes the socket with a code.
const REALTIME_SOCKET = /^\/api\/realtime\/[^/]+\/[^/]+\/socket$/;
const API_PREFIX = "/api/";
// The plugin's default server-function endpoint.
const SERVER_FUNCTION_ENDPOINT = "/_server";

export function classifyRequest(pathname: string): RequestClass {
  if (pathname.startsWith(MACHINE_PREFIX)) {
    return "machine";
  }
  if (isUnder(pathname, PUBLIC_API_PREFIX)) {
    return "public_api";
  }
  if (REALTIME_SOCKET.test(pathname)) {
    return "realtime_socket";
  }
  if (pathname.startsWith(API_PREFIX)) {
    return "api";
  }
  if (isUnder(pathname, SERVER_FUNCTION_ENDPOINT)) {
    return "server_function";
  }
  return "page";
}

function isUnder(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}
