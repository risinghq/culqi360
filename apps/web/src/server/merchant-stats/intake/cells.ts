import {
  calendarDateFromParts,
  parseCalendarMonth,
  type CalendarDate,
  type CalendarMonth,
} from "~/domain/time/calendar-date";

export function cellText(value: string | undefined): string {
  return (value ?? "").trim();
}

export function cellTextOrNull(value: string | undefined): string | null {
  const text = cellText(value);
  return text.length > 0 ? text : null;
}

export function cellNumberOrNull(value: string | undefined): number | null {
  const text = (value ?? "").replace(/[^\d.-]/g, "");
  if (text === "") {
    return null;
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

export function cellNumber(value: string | undefined): number {
  return cellNumberOrNull(value) ?? 0;
}

export function cellDateOrNull(value: string | undefined): CalendarDate | null {
  const text = cellText(value);
  if (/^\d{5}$/.test(text)) {
    return excelSerialDate(Number(text));
  }
  return text ? parseFlexibleDate(text) : null;
}

export function saleMonthFromAnomes(
  value: string | undefined,
): CalendarMonth | null {
  const text = (value ?? "").replace(/\D/g, "");
  if (text.length !== 6) {
    return null;
  }
  return parseCalendarMonth(`${text.slice(0, 4)}-${text.slice(4, 6)}`);
}

// The browser sends a date-formatted cell as ISO text. A date column left in
// General format arrives as its Excel serial: days since 1899-12-30.
function excelSerialDate(serial: number): CalendarDate | null {
  const date = new Date(Math.round((serial - 25569) * 86_400_000));
  return buildDate(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
  );
}

// Dealer columns ultima_trx, dia_activo, and dia_prueba use ISO dates.
// fecha_venta uses d/m/y. In sampled exports, 1,013 of 1,340 cells prove
// d/m/y and none prove m/d/y, so the 327 ambiguous cells default to d/m/y.
// A cell whose second part exceeds 12 identifies m/d/y if the export changes locale.
function parseFlexibleDate(text: string): CalendarDate | null {
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    return buildDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  const parts = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (parts) {
    const first = Number(parts[1]);
    const second = Number(parts[2]);
    const [month, day] =
      first > 12
        ? [second, first]
        : second > 12
          ? [first, second]
          : [second, first];
    return buildDate(Number(parts[3]), month, day);
  }

  return null;
}

function buildDate(
  year: number,
  month: number,
  day: number,
): CalendarDate | null {
  try {
    return calendarDateFromParts({ year, month, day });
  } catch {
    return null;
  }
}
