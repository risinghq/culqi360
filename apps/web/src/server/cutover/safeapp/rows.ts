import type { SourceTable } from "./source";

export type SkippedRow = {
  table: SourceTable;
  sourceId: string;
  reason: string;
};

export class Warnings {
  readonly counts: Record<string, number> = {};

  add(key: string): void {
    this.counts[key] = (this.counts[key] ?? 0) + 1;
  }
}

export function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?/;

function validDate(year: string, month: string, dayOfMonth: string): boolean {
  const iso = `${year}-${month}-${dayOfMonth}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso
  );
}

// safeapp stored missing dates as 0000-00-00 before its own cutover.
export function day(value: string | null | undefined): string | null {
  const match = DATE_TIME.exec(value ?? "");
  if (!match?.[1] || !match[2] || !match[3]) {
    return null;
  }
  return validDate(match[1], match[2], match[3])
    ? `${match[1]}-${match[2]}-${match[3]}`
    : null;
}

// safeapp writes 0 for an unset reference.
export function sourceId(value: string | null | undefined): string | null {
  const trimmed = text(value);
  return trimmed && /^\d+$/.test(trimmed) && Number(trimmed) > 0
    ? String(Number(trimmed))
    : null;
}

export function amount(value: string | null | undefined): number | null {
  const trimmed = text(value);
  if (trimmed === null) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

// safeapp's dates and times are Lima wall-clock values.
export function limaMidnight(date: string): Date {
  return new Date(`${date}T00:00:00-05:00`);
}

export function limaTime(value: string | null | undefined): Date | null {
  const date = day(value);
  const match = DATE_TIME.exec(value ?? "");
  if (!date || !match) {
    return null;
  }
  const time = match[4] ? `${match[4]}:${match[5]}:${match[6]}` : "00:00:00";
  const parsed = new Date(`${date}T${time}-05:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
