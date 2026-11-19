import { readAuthFunnelClientEvent } from "~/domain/observability/auth-funnel";
import { logAuthClientEvent } from "~/server/auth/ui/funnel-log";

export async function trackAuthClientEvent(input: unknown): Promise<void> {
  "use server";

  const event = readAuthFunnelClientEvent(input);
  if (event) {
    logAuthClientEvent(event);
  }
}
