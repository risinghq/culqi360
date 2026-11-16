import { describe, expect, it } from "vitest";
import { utils, write } from "xlsx";

import { parseCampaignFile } from "~/server/campaigns/infrastructure/campaign-file";

const bytes = (text: string) => new TextEncoder().encode(text);

function workbook(rows: unknown[][]): Uint8Array {
  const book = utils.book_new();
  utils.book_append_sheet(book, utils.aoa_to_sheet(rows), "Base");
  return new Uint8Array(write(book, { type: "array", bookType: "xlsx" }));
}

describe("campaign file", () => {
  it("reads a semicolon CSV below a title line, keyed by the named segment column", () => {
    const csv = [
      "﻿Base noviembre;;;",
      "RUC;Razón Social;Origen;Nodo",
      "20100000001;Acme SAC;PYME;Lima",
      ";;;",
      "20100000002;;CORP;",
    ].join("\r\n");

    const parsed = parseCampaignFile(bytes(csv), {
      extension: "csv",
      segmentColumn: "origen",
    });

    expect(parsed).toEqual({
      ok: true,
      value: [
        {
          line: 3,
          ruc: "20100000001",
          legalName: "Acme SAC",
          segment: "PYME",
          facts: { nodo: "Lima" },
        },
        {
          line: 5,
          ruc: "20100000002",
          legalName: "",
          segment: "CORP",
          facts: { nodo: "" },
        },
      ],
    });
  });

  it("reads the first sheet of a workbook and reports sheet line numbers", () => {
    const file = workbook([
      ["ruc", "razon_social", "segmento", "lineas"],
      [20100000001, "Acme SAC", "PYME", 3],
    ]);

    const parsed = parseCampaignFile(file, {
      extension: "xlsx",
      segmentColumn: "Segmento",
    });

    expect(parsed).toEqual({
      ok: true,
      value: [
        {
          line: 2,
          ruc: "20100000001",
          legalName: "Acme SAC",
          segment: "PYME",
          facts: { lineas: "3" },
        },
      ],
    });
  });

  it("refuses a file without the RUC or segment column", () => {
    const parsed = parseCampaignFile(
      bytes("ruc,razon_social\n20100000001,Acme"),
      {
        extension: "csv",
        segmentColumn: "origen",
      },
    );

    expect(parsed).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "campaign_file_columns_missing" }),
    });
  });
});
