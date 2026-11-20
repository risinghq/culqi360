import { describe, expect, it } from "vitest";

import { validateUploadFile } from "~/server/files/validators";

const CSV_BYTES = new TextEncoder().encode(
  "ruc,nombre\n12345678901,Empresa SA",
);
const XLSX_MAGIC = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);

describe("validateUploadFile", () => {
  it.each([
    ["case_file", "data.csv", CSV_BYTES],
    ["merchant_gpv_snapshot", "data.xlsx", XLSX_MAGIC],
    ["transactions_report", "report.csv", CSV_BYTES],
  ] as const)("accepts %s upload %s", (purpose, filename, bytes) => {
    expect(validateUploadFile(purpose, filename, bytes)).toMatchObject({
      ok: true,
    });
  });

  it.each([
    [
      "an extension not allowed for the purpose",
      "sale_proof",
      "GPV AL 03-07-2026.xlsx",
      XLSX_MAGIC,
      "extension_not_allowed",
    ],
    [
      "a file without extension",
      "transactions_report",
      "noext",
      CSV_BYTES,
      "missing_extension",
    ],
    [
      "a path segment",
      "transactions_report",
      "../evil.csv",
      CSV_BYTES,
      "filename_invalid",
    ],
    [
      "a name over 120 chars",
      "transactions_report",
      `${"a".repeat(121)}.csv`,
      CSV_BYTES,
      "filename_invalid",
    ],
    [
      "a file over the 20 MB default limit",
      "transactions_report",
      "big.csv",
      new Uint8Array(21 * 1024 * 1024),
      "file_too_large",
    ],
    [
      "a double extension",
      "transactions_report",
      "file.php.csv",
      CSV_BYTES,
      "double_extension_blocked",
    ],
  ] as const)("rejects %s", (_, purpose, filename, bytes, reason) => {
    expect(validateUploadFile(purpose, filename, bytes)).toMatchObject({
      ok: false,
      reason,
    });
  });

  it("describes an accepted csv with its sanitized name, signature and MIME", () => {
    const result = validateUploadFile(
      "transactions_report",
      "mi archivo@datos.csv",
      CSV_BYTES,
    );

    expect(result).toMatchObject({
      ok: true,
      safeDisplayFilename: "mi archivo_datos.csv",
      signatureKind: "csv",
      detectedMime: "text/csv; charset=utf-8",
    });
  });
});
