import type { Kysely } from "kysely";

import type { WorkspaceId } from "~/domain/ids";
import type { PlatformDatabase } from "~/server/platform/database/types";
import type { OperationContext } from "~/server/platform/operation/context";
import { Ok, type Result } from "~/shared/result";

import { kapsoEnvelopePhoneNumberId } from "./kapso-envelope";
import type {
  KapsoDelivery,
  KapsoWebhookReceipt,
  ReceiptError,
} from "./receive-webhook";

export interface WhatsAppReceiver {
  receiveWhatsApp(
    delivery: KapsoDelivery,
    operation: OperationContext,
  ): Promise<Result<KapsoWebhookReceipt, ReceiptError>>;
}

// A delivery names the number it was sent to; the workspace that owns that
// number receives it. "unrouted" means no workspace ever will.
export function createWhatsAppRouter(
  db: Kysely<PlatformDatabase>,
  workspace: (workspaceId: WorkspaceId) => Promise<WhatsAppReceiver>,
) {
  return async (
    delivery: KapsoDelivery,
    operation: OperationContext,
  ): Promise<Result<KapsoWebhookReceipt | "unrouted", string>> => {
    const workspaceId = await deliveryWorkspace(db, delivery.rawBody);
    if (!workspaceId.ok) {
      return workspaceId;
    }
    if (workspaceId.value === null) {
      return Ok("unrouted");
    }
    return (await workspace(workspaceId.value)).receiveWhatsApp(
      delivery,
      operation,
    );
  };
}

async function deliveryWorkspace(
  db: Kysely<PlatformDatabase>,
  rawBody: string,
): Promise<Result<WorkspaceId | null, string>> {
  const phoneNumberId = kapsoEnvelopePhoneNumberId(rawBody);
  if (!phoneNumberId.ok) {
    return phoneNumberId;
  }
  if (phoneNumberId.value === null) {
    return Ok(null);
  }
  const row = await db
    .selectFrom("whatsapp_numbers")
    .select("workspace_id")
    .where("phone_number_id", "=", phoneNumberId.value)
    .executeTakeFirst();
  return Ok(row?.workspace_id ?? null);
}
