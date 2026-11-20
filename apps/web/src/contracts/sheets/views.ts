// A one-sheet table the server fills and the browser saves as an .xlsx file.
// A date cell is an Excel serial number; the column's format shows it as a
// date.
export type SheetCell = number | string | null;

export type SheetColumnView = {
  header: string;
  width: number | null;
  // An Excel number format, such as "dd/mm/yyyy" or "#,##0.00".
  format: string | null;
};

export type SheetFileView = {
  filename: string;
  title: string;
  subject: string | null;
  sheetName: string;
  columns: SheetColumnView[];
  rows: SheetCell[][];
};

// A CSV file the server writes in full and the browser saves as is.
export type CsvFileView = { filename: string; text: string };
