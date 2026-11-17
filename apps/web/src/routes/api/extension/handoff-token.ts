import type { APIEvent } from "filesystem-routing/api";

import type { CallRequestSubjectKind } from "~/contracts/calls";
import { hasPermission, type Permission } from "~/domain/auth/access/rbac";
import { CampaignRecordId, CaseId, ContactAssignmentId } from "~/domain/ids";
import type { CallRequestSubject } from "~/server/calls/application/resolve-call-target";
import { getApplication } from "~/server/composition/application";
import {
  isCreateExtensionHandoffTokenRequest,
  type CreateExtensionHandoffTokenRequest,
} from "~/server/extension/contracts";
import { toWire } from "~/server/platform/action/domain-error";
import { getRequestOperation } from "~/server/platform/http/request-context-storage";
import { authorizeRoutePermission } from "~/server/platform/http/route-access";
import { isErr } from "~/shared/result";

import { readJsonBody } from "./json-body";

// Calling a subject is part of working it.
const PERMISSION_BY_KIND: Record<CallRequestSubjectKind, Permission> = {
  assignment: "lead:work",
  campaign_record: "campaign:work",
  case: "case:work",
};

const STATUS_BY_CODE: Record<string, number> = {
  call_subject_not_found: 404,
  call_phone_missing: 409,
  handoff_origin_not_allowed: 403,
  origin_required: 403,
  misconfigured: 503,
};

function parseSubject(
  subject: CreateExtensionHandoffTokenRequest["subject"],
): CallRequestSubject | null {
  switch (subject.kind) {
    case "assignment": {
      const id = ContactAssignmentId.parse(subject.id);
      return isErr(id) ? null : { kind: "assignment", assignmentId: id.value };
    }
    case "campaign_record": {
      const id = CampaignRecordId.parse(subject.id);
      return isErr(id)
        ? null
        : { kind: "campaign_record", campaignRecordId: id.value };
    }
    case "case": {
      const id = CaseId.parse(subject.id);
      return isErr(id) ? null : { kind: "case", caseId: id.value };
    }
  }
}

function invalidRequest(): Response {
  return Response.json(
    { error: "Invalid handoff token request" },
    { status: 400 },
  );
}

export async function POST(event: APIEvent): Promise<Response> {
  const parsed = await readJsonBody(event.request);
  if (!parsed.ok) {
    return parsed.response;
  }
  if (!isCreateExtensionHandoffTokenRequest(parsed.body)) {
    return invalidRequest();
  }
  const body = parsed.body;
  const subject = parseSubject(body.subject);
  if (subject === null) {
    return invalidRequest();
  }

  const auth = await authorizeRoutePermission(
    PERMISSION_BY_KIND[body.subject.kind],
  );
  if (isErr(auth)) {
    return auth.error;
  }
  const session = auth.value;
  const operation = getRequestOperation();
  const app = getApplication();

  const target = await app.calls.resolveTarget(
    {
      userId: session.userId,
      branchId: session.branchId,
      roleKey: session.roleKey,
      viewAll: hasPermission(session, "case:view:all"),
    },
    { subject, phone: body.phone ?? null },
    operation.operationAt,
  );

  const result = isErr(target)
    ? target
    : await app.extension.createHandoffToken(
        {
          userId: session.userId,
          authSessionId: session.id,
          branchId: session.branchId,
          target: target.value,
          origin: event.request.headers.get("origin") ?? "",
        },
        operation,
      );

  if (isErr(result)) {
    const status = STATUS_BY_CODE[result.error.code ?? ""] ?? 500;
    return Response.json({ error: toWire(result.error).message }, { status });
  }

  return Response.json(result.value, { status: 200 });
}
