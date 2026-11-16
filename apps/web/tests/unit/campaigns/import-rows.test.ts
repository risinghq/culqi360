import { describe, expect, it } from "vitest";

import { checkImportRows } from "~/server/campaigns/domain/import-rows";

describe("campaign import rows", () => {
  it("keeps valid rows and reports each rejected line with its reason", () => {
    const checked = checkImportRows([
      {
        line: 2,
        ruc: " 20100000001 ",
        legalName: "Acme SAC",
        segment: "PYME",
        facts: { lineas: 3, deuda: "", plan: " Fibra " },
      },
      { line: 3, ruc: "2010", legalName: null, segment: "PYME", facts: {} },
      { line: 4, ruc: "20100000002", legalName: "", segment: " ", facts: {} },
    ]);

    expect(checked.records).toEqual([
      {
        ruc: "20100000001",
        legalName: "Acme SAC",
        segment: "PYME",
        facts: { lineas: "3", plan: "Fibra" },
      },
    ]);
    expect(checked.rejected).toEqual([
      { line: 3, error: expect.objectContaining({ code: "invalid_ruc" }) },
      {
        line: 4,
        error: expect.objectContaining({ code: "campaign_segment_missing" }),
      },
    ]);
  });

  it("keeps the later line when a company repeats in one segment", () => {
    const checked = checkImportRows([
      {
        line: 2,
        ruc: "20100000001",
        legalName: "Old",
        segment: "A",
        facts: {},
      },
      { line: 3, ruc: "20100000001", legalName: null, segment: "B", facts: {} },
      {
        line: 4,
        ruc: "20100000001",
        legalName: "New",
        segment: "A",
        facts: {},
      },
    ]);

    expect(
      checked.records.map((record) => [record.segment, record.legalName]),
    ).toEqual([
      ["B", null],
      ["A", "New"],
    ]);
  });
});
