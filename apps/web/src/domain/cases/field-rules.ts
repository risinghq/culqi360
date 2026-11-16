import {
  addCalendarDays,
  parseCalendarDate,
  type CalendarDate,
} from "~/domain/time/calendar-date";

export type CaseValue = string | number | null;
export type CaseValues = Readonly<Record<string, CaseValue>>;

// When a field that is not always required becomes required:
// - value: another field holds one of the values;
// - status: the field's own stage holds one of the statuses;
// - age: a date field is at least `days` days before today.
export type CaseFieldCondition =
  | { kind: "value"; fieldKey: string; values: readonly string[] }
  | { kind: "status"; statuses: readonly string[] }
  | { kind: "age"; fieldKey: string; days: number };

export type CaseNumberBounds = {
  min?: number;
  max?: number;
  integer?: boolean;
};

export type RequirableField = {
  stageKey: string;
  required: boolean;
  requiredWhen?: CaseFieldCondition | null;
};

// The case as a write would leave it. `today` is the calendar date in the
// app's time zone, so an age condition flips at local midnight.
export type RequirementContext = {
  values: CaseValues;
  statuses: Readonly<Record<string, string>>;
  today: CalendarDate;
};

export function isFieldRequired(
  field: RequirableField,
  context: RequirementContext,
): boolean {
  if (field.required) {
    return true;
  }
  const condition = field.requiredWhen;
  if (!condition) {
    return false;
  }
  switch (condition.kind) {
    case "value": {
      const value = context.values[condition.fieldKey];
      return typeof value === "string" && condition.values.includes(value);
    }
    case "status": {
      const status = context.statuses[field.stageKey];
      return status !== undefined && condition.statuses.includes(status);
    }
    case "age": {
      const since = parseCalendarDate(context.values[condition.fieldKey]);
      return (
        since !== null &&
        addCalendarDays(since, condition.days) <= context.today
      );
    }
  }
}

export function isWithinBounds(
  bounds: CaseNumberBounds,
  value: number,
): boolean {
  return (
    (!bounds.integer || Number.isInteger(value)) &&
    (bounds.min === undefined || value >= bounds.min) &&
    (bounds.max === undefined || value <= bounds.max)
  );
}
