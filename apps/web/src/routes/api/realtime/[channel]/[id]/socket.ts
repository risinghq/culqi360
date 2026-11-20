import { getRequestEvent } from "@solidjs/web";
import type { APIHandler } from "filesystem-routing/api";

import { REALTIME_CLOSE } from "~/contracts/realtime/channel";
import { getApplication } from "~/server/composition/application";
import { getRequestContext } from "~/server/platform/http/request-context-storage";
import { refuseSocket } from "~/server/realtime/sockets";

// The server that received the request answers the handshake itself, so this
// response only stands in for it.
function upgraded(): Response {
  return new Response(null, { status: 200 });
}

export const GET: APIHandler = async (event) => {
  const upgrade = getRequestEvent()?.locals.socketUpgrade;

  if (!upgrade) {
    return new Response("Expected a WebSocket handshake", {
      status: 426,
      headers: { upgrade: "websocket" },
    });
  }

  // CSRF checks skip GET, and a handshake is a GET that carries the session
  // cookie from any site, so the socket checks its origin itself.
  const context = getRequestContext();
  if (event.request.headers.get("origin") !== context.publicOrigin) {
    return new Response("Forbidden", { status: 403 });
  }

  // The route only matches with both segments filled, but the matcher types
  // params as optional, so reject rather than assert them into existence.
  const channel = event.params?.channel;
  const id = event.params?.id;
  if (!channel || !id) {
    return new Response("Missing channel or id", { status: 400 });
  }

  // Without a signed-in session there is no workspace application to ask.
  if (context.principal?.sessionClass !== "app") {
    refuseSocket(upgrade, REALTIME_CLOSE.unauthenticated, "unauthenticated");
    return upgraded();
  }

  await getApplication().realtime.connect(
    context.principal,
    {
      channel,
      id,
      cursor: new URL(event.request.url).searchParams.get("cursor"),
    },
    upgrade,
  );

  return upgraded();
};
