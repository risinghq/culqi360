import { makeAuthSession } from "@tests/support/unit/factories";
import { describe, expect, it } from "vitest";

import { memberHasPermission } from "~/domain/auth/access/workspace-modules";
import {
  authorizeModule,
  authorizePermission,
} from "~/server/platform/action/session";
import { isErr } from "~/shared/result";

describe("workspace modules", () => {
  it("denies a module permission to a workspace without the module", () => {
    const caseOnly = { role: "admin" as const, modules: [] };
    const culqiOnly = { role: "admin" as const, modules: ["culqi" as const] };

    expect(memberHasPermission(caseOnly, "lead:work")).toBe(false);
    expect(memberHasPermission(culqiOnly, "lead:work")).toBe(true);
    expect(memberHasPermission(culqiOnly, "search:use")).toBe(false);
    expect(memberHasPermission(caseOnly, "case:work")).toBe(true);
    expect(memberHasPermission(caseOnly, "team:read")).toBe(true);
  });

  it("still applies the role inside a workspace that has the module", () => {
    const hr = { role: "hr" as const, modules: ["culqi" as const] };

    expect(memberHasPermission(hr, "lead:work")).toBe(false);
  });

  it("forbids actions gated by a module the workspace lacks", () => {
    const session = makeAuthSession({ role: "admin", modules: [] });

    expect(isErr(authorizeModule(session, "culqi"))).toBe(true);
    expect(isErr(authorizePermission(session, "lead:review"))).toBe(true);
    expect(isErr(authorizePermission(session, "campaign:work"))).toBe(false);

    const culqi = makeAuthSession({ role: "admin" });

    expect(isErr(authorizeModule(culqi, "culqi"))).toBe(false);
    expect(isErr(authorizePermission(culqi, "lead:review"))).toBe(false);
  });
});
