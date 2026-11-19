import { isCreateRecordingRequest } from "@crm/contracts/extension";
import type { APIEvent } from "filesystem-routing/api";

import { openExtensionApplication } from "~/server/composition/application";
import { getRequestOperation } from "~/server/platform/http/request-context-storage";
import { isErr } from "~/shared/result";

import { readJsonBody } from "../json-body";
import { extensionErrorResponse, getBearerToken } from "../response";

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
    if (!isCreateRecordingRequest(parsed.body)) {
      return Response.json(
        { error: "Invalid create recording request" },
        { status: 400 },
      );
    }

    const result = await application.extension.createRecording(
      { sessionToken, callId: parsed.body.callId },
      getRequestOperation(),
    );
    if (isErr(result)) {
      return extensionErrorResponse(result.error);
    }

    return Response.json(result.value, { status: 200 });
  } catch {
    return new Response("Unexpected error", { status: 500 });
  }
}
