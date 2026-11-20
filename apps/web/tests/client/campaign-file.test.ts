import { describe, expect, it } from "vitest";
import { utils, write } from "xlsx";

import { readCampaignFile } from "~/features/campaigns/data/campaign-file";

function workbook(rows: unknown[][]): File {
  const book = utils.book_new();
  utils.book_append_sheet(book, utils.aoa_to_sheet(rows), "Base");
  const bytes: unknown = write(book, { type: "array", bookType: "xlsx" });
  if (!(bytes instanceof ArrayBuffer)) {
    throw new Error("xlsx did not write an ArrayBuffer");
  }
  return new File([bytes], "base.xlsx");
}

describe("campaign file", () => {
  it("reads a semicolon CSV below a title line and keeps file line numbers", async () => {
    const csv = [
      "﻿Base noviembre;;;",
      "RUC;Razón Social;Origen;Nodo",
      "20100000001;Acme SAC;PYME;Lima",
      ";;;",
      "20100000002;;CORP;",
    ].join("\r\n");

    const read = await readCampaignFile(new File([csv], "base.csv"), "Origen");

    expect(read).toEqual({
      ok: true,
      table: {
        columns: ["ruc", "razon_social", "origen", "nodo"],
        lines: [
          { line: 3, cells: ["20100000001", "Acme SAC", "PYME", "Lima"] },
          { line: 5, cells: ["20100000002", "", "CORP", ""] },
        ],
      },
    });
  });

  it("reads a workbook sheet as displayed, so a numeric RUC keeps its digits", async () => {
    const file = workbook([
      ["ruc", "razon_social", "segmento", "lineas"],
      [20100000001, "Acme SAC", "PYME", 3],
    ]);

    const read = await readCampaignFile(file, "Segmento");

    expect(read).toEqual({
      ok: true,
      table: {
        columns: ["ruc", "razon_social", "segmento", "lineas"],
        lines: [{ line: 2, cells: ["20100000001", "Acme SAC", "PYME", "3"] }],
      },
    });
  });

  it("refuses a file without the RUC or segment column", async () => {
    const read = await readCampaignFile(
      new File(["ruc,razon_social\n20100000001,Acme"], "base.csv"),
      "origen",
    );

    expect(read).toEqual({
      ok: false,
      message: "El archivo no tiene las columnas de RUC y segmento.",
    });
  });

  it("refuses a file that is neither CSV nor xlsx", async () => {
    const read = await readCampaignFile(new File(["x"], "base.xls"), "origen");

    expect(read.ok).toBe(false);
  });
});
