import { describe, expect, it } from "vitest";

import { computeNeededHolds } from "~/server/contacts/domain/hold-demand";

describe("computeNeededHolds", () => {
  it.each([
    { active: 10, target: 10, expected: 0, desc: "exact match" },
    { active: 15, target: 10, expected: 0, desc: "exceeds target" },
    { active: 100, target: 50, expected: 0, desc: "significantly exceeds" },
    { active: 5, target: 10, expected: 5, desc: "below target" },
    { active: 0, target: 10, expected: 10, desc: "zero active" },
    { active: 40, target: 50, expected: 10, desc: "partial buffer needed" },
    { active: 0, target: 0, expected: 0, desc: "zero buffer target" },
    { active: 10, target: 0, expected: 0, desc: "active with zero target" },
    {
      active: 1_000_000,
      target: 2_000_000,
      expected: 1_000_000,
      desc: "large values",
    },
  ])(
    "returns $expected when active is $active and target is $target ($desc)",
    ({ active, target, expected }) => {
      expect(computeNeededHolds(active, target)).toBe(expected);
    },
  );
});
