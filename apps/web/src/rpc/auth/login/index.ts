import { redirect } from "@solidjs/web";

import type { PasskeyLoginFlowState } from "~/domain/auth/passkey/types";
import { fail, internal } from "~/domain/errors";
import { logAuthOutcome } from "~/server/auth/ui/funnel-log";
import {
  completeLoginAndRedirect,
  readLoginFlowId,
  readLoginText,
  readPasskeyStartMode,
} from "~/server/auth/ui/login-support";
import { getPlatform } from "~/server/composition/application";
import { throwDomain } from "~/server/platform/action/domain-error";
import {
  getRequestClientMetadata,
  getRequestContext,
  getRequestOperation,
} from "~/server/platform/http/request-context-storage";
import { isErr } from "~/shared/result";

export async function passwordLogin(
  formData: FormData,
): Promise<{ nextStep: "passkey"; flow: PasskeyLoginFlowState }> {
  "use server";

  const identifier = readLoginText(formData, "identifier");
  const password = readLoginText(formData, "password", { trim: false });
  const { ipAddress, userAgent } = getRequestClientMetadata();
  const operation = getRequestOperation();

  const result = await getPlatform().auth.login.password(
    {
      identifier,
      password,
      ipAddress,
      userAgent,
    },
    getRequestContext().publicOrigin,
    operation,
  );

  if (isErr(result)) {
    logAuthOutcome({
      kind: "password_result",
      outcome: "failed",
      code: result.error.kind,
    });

    throwDomain(fail(result.error.kind));
  }

  if (result.value.kind === "totp_required") {
    logAuthOutcome({ kind: "password_result", outcome: "totp_required" });

    throw redirect(`/login/verify?flow=${result.value.flow.id}`);
  }

  if (result.value.kind === "passkey_required") {
    logAuthOutcome({ kind: "password_result", outcome: "passkey_required" });

    return {
      nextStep: "passkey",
      flow: result.value.flow,
    };
  }

  logAuthOutcome({ kind: "password_result", outcome: "succeeded" });

  return completeLoginAndRedirect(result.value.result);
}

export async function passkeyStart(
  formData: FormData,
): Promise<{ flow: PasskeyLoginFlowState }> {
  "use server";

  const mode = readPasskeyStartMode(formData);

  if (!mode) {
    throwDomain(internal("Invalid passkey login mode"));
  }

  const { ipAddress } = getRequestClientMetadata();
  const operation = getRequestOperation();

  const command =
    mode === "identified"
      ? {
          identifier: readLoginText(formData, "identifier"),
          ipAddress,
          mode,
        }
      : {
          ipAddress,
          mode,
        };

  const result = await getPlatform().auth.login.startPasskey(
    command,
    getRequestContext().publicOrigin,
    operation,
  );

  if (isErr(result)) {
    logAuthOutcome({
      kind: "passkey_start_result",
      outcome: "failed",
      code: "invalid_credentials",
    });

    throwDomain(fail("invalid_credentials"));
  }

  logAuthOutcome({ kind: "passkey_start_result", outcome: "started" });

  return { flow: result.value };
}

export async function totpLogin(formData: FormData): Promise<void> {
  "use server";

  const flowId = readLoginFlowId(formData, "flowId");
  const totpCode = readLoginText(formData, "totpCode");

  if (!flowId) {
    throwDomain(fail("flow_expired"));
  }

  const { ipAddress, userAgent } = getRequestClientMetadata();
  const operation = getRequestOperation();

  const verified = await getPlatform().auth.login.verifyTotp(
    {
      flowId,
      totpCode,
      ipAddress,
    },
    operation,
  );

  if (isErr(verified)) {
    if (verified.error.kind === "flow_expired") {
      logAuthOutcome({
        kind: "totp_result",
        outcome: "failed",
        code: "flow_expired",
      });

      throwDomain(fail("flow_expired"));
    }

    logAuthOutcome({
      kind: "totp_result",
      outcome: "failed",
      code: "invalid_totp",
    });

    throwDomain(fail("totp_code_invalid"));
  }

  const completed = await getPlatform().auth.login.complete(
    {
      proof: verified.value,
      ipAddress,
      userAgent,
    },
    operation,
  );

  if (isErr(completed)) {
    throwDomain(
      fail(
        completed.error.kind === "flow_expired"
          ? "flow_expired"
          : "totp_code_invalid",
      ),
    );
  }

  logAuthOutcome({ kind: "totp_result", outcome: "succeeded" });

  return completeLoginAndRedirect(completed.value);
}

export async function recoveryLogin(formData: FormData): Promise<void> {
  "use server";

  const flowId = readLoginFlowId(formData, "flowId");
  const recoveryCode = readLoginText(formData, "recoveryCode");

  if (!flowId) {
    throwDomain(fail("flow_expired"));
  }

  const { ipAddress, userAgent } = getRequestClientMetadata();
  const operation = getRequestOperation();

  const verified = await getPlatform().auth.login.verifyRecovery(
    {
      flowId,
      recoveryCode,
      ipAddress,
    },
    operation,
  );

  if (isErr(verified)) {
    throwDomain(
      fail(
        verified.error.kind === "flow_expired"
          ? "flow_expired"
          : "recovery_code_invalid",
      ),
    );
  }

  const completed = await getPlatform().auth.login.complete(
    {
      proof: verified.value,
      ipAddress,
      userAgent,
    },
    operation,
  );

  if (isErr(completed)) {
    throwDomain(
      fail(
        completed.error.kind === "flow_expired"
          ? "flow_expired"
          : "recovery_code_invalid",
      ),
    );
  }

  return completeLoginAndRedirect(completed.value);
}
