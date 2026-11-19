import { redirect } from "@solidjs/web";

import type { OnboardingSnapshot } from "~/contracts/auth";
import { getSessionPath } from "~/domain/auth/access/route-policy";
import { getPlatform } from "~/server/composition/application";
import { getSession } from "~/server/platform/action/session";
import { isErr } from "~/shared/result";

export async function getOnboardingSnapshot(): Promise<OnboardingSnapshot> {
  const session = await getSession();
  if (!session) {
    throw redirect("/login");
  }
  if (session.sessionClass !== "pre_auth") {
    throw redirect(getSessionPath(session.sessionClass));
  }

  const result = await getPlatform().auth.onboarding.snapshot({
    userId: session.userId,
    workspaceId: session.workspaceId,
  });
  if (isErr(result)) {
    throw redirect("/login");
  }
  return result.value;
}
