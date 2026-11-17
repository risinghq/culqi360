import { describe, expect, it } from "vitest";

import {
  canGrantPermissions,
  roleKeyFromName,
} from "~/domain/auth/access/role-admin";

describe("roleKeyFromName", () => {
  it("folds accents, case and punctuation into a slug", () => {
    expect(roleKeyFromName("  Gestor de Cobranza (Norte) ")).toBe(
      "gestor_de_cobranza_norte",
    );
    expect(roleKeyFromName("Atención Ñandú")).toBe("atencion_nandu");
  });

  it("is empty when the name has no letters or digits", () => {
    expect(roleKeyFromName(" -- ")).toBe("");
  });
});

describe("canGrantPermissions", () => {
  const editor = { permissions: ["team:read", "role:manage"] as const };

  it("allows permissions the editor holds", () => {
    expect(canGrantPermissions(editor, [], ["team:read"])).toBe(true);
  });

  it("rejects a permission the editor lacks", () => {
    expect(canGrantPermissions(editor, [], ["team:manage"])).toBe(false);
  });

  it("keeps a permission the role already has, held or not", () => {
    expect(
      canGrantPermissions(
        editor,
        ["team:manage"],
        ["team:manage", "team:read"],
      ),
    ).toBe(true);
  });
});
