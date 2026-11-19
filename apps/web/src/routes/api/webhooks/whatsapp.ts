import type { APIEvent } from "filesystem-routing/api";

import { getHost, getPlatform } from "~/server/composition/application";
import { getRequestOperation } from "~/server/platform/http/request-context-storage";
import { createLogger } from "~/shared/observability/runtime-logger";

const logger = createLogger("whatsapp-webhook");

export function GET(event: APIEvent): Response {
  const url = new URL(event.request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (
    challenge &&
    getPlatform().webhooks.verifyWhatsAppSubscription({ mode, token })
  ) {
    return new Response(challenge, {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  }

  return new Response("Forbidden", { status: 403 });
}

export async function POST(event: APIEvent): Promise<Response> {
  try {
    const rawBody = await event.request.text();
    const host = await getHost();

    const workspaceId = await host.platform.routing.whatsAppWorkspace(rawBody);
    if (!workspaceId.ok) {
      logger.warn("whatsapp_webhook_rejected", { reason: workspaceId.error });
      return new Response("Bad Request", { status: 400 });
    }
    // Kapso retries anything but a 2xx, and a number no workspace owns, or a
    // delivery with no message in it, will never route.
    if (workspaceId.value === null) {
      logger.info("whatsapp_webhook_unrouted");
      return new Response("OK", { status: 200 });
    }

    const application = await host.workspace(workspaceId.value);
    const result = await application.notifications.webhooks.receiveKapso(
      {
        idempotencyKey: event.request.headers.get("x-idempotency-key"),
        eventType: event.request.headers.get("x-webhook-event"),
        payloadVersion: event.request.headers.get("x-webhook-payload-version"),
        rawBody,
      },
      getRequestOperation(),
    );

    if (!result.ok) {
      logger.warn("whatsapp_webhook_rejected", { reason: result.error });
      return new Response("Bad Request", { status: 400 });
    }

    logger.info("whatsapp_webhook_received", { receipt: result.value });
    return new Response("OK", { status: 200 });
  } catch (error) {
    logger.error("whatsapp_webhook_receipt_failed", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return new Response("Service Unavailable", { status: 503 });
  }
}
