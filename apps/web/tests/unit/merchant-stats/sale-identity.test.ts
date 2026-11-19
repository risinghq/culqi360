import { describe, expect, it } from "vitest";

import { saleIdentityKey } from "~/server/merchant-stats/intake/sale-identity";

describe("saleIdentityKey", () => {
  it("creates an unambiguous placement identity without NUL separators", () => {
    const key = saleIdentityKey("merchant-1", "CULQI FULL", "serial-1");

    expect(key).not.toContain("\u0000");
    expect(JSON.parse(key)).toEqual(["merchant-1", "CULQI FULL", "serial-1"]);
  });
});
