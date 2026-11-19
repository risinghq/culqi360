import type { APIEvent } from "filesystem-routing/api";

import { openExtensionApplication } from "~/server/composition/application";
import { isExtensionRuntimeEventEnvelope } from "~/server/extension/contracts";
import { getRequestOperation } from "~/server/platform/http/request-context-storage";
import { isErr } from "~/shared/result";

import { readJsonBody } from "./json-body";
import { extensionErrorResponse, getBearerToken } from "./response";

export async function POST(event: APIEvent): Promise<Response> {
  try {
    const sessionToken = getBearerToken(event.request);
    const application = sessionToken
      ? await openExtensionApplication(sessionToken)
      : null;

    if (!sessionToken || !application) {
      return new Response("Unauthorized", { status: 401 });
    }

    const parsed = await readJsonBody(event.request);

    if (!parsed.ok) {
      return parsed.response;
    }

    if (!isExtensionRuntimeEventEnvelope(parsed.body)) {
      return Response.json(
        { error: "Invalid extension event payload" },
        { status: 400 },
      );
    }

    const result = await application.extension.ingestRuntimeEvent(
      {
        sessionToken,
        event: parsed.body,
      },
      getRequestOperation(),
    );

    if (isErr(result)) {
      return extensionErrorResponse(result.error);
    }

    return Response.json({ ok: true });
  } catch {
    return new Response("Unexpected error", { status: 500 });
  }
}
