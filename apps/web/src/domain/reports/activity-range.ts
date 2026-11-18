import {
  addCalendarDays,
  type CalendarDate,
} from "~/domain/time/calendar-date";

// The screen lists the newest rows; the export holds the whole range.
export const ACTIVITY_SCREEN_LIMIT = 200;

const MAX_RANGE_DAYS = 366;

export type ActivityRangeProblem = "reversed" | "too_long";

/** Checks an inclusive range of app days against the report's one-year cap. */
export function activityRangeProblem(
  from: CalendarDate,
  to: CalendarDate,
): ActivityRangeProblem | null {
  if (from > to) {
    return "reversed";
  }
  if (addCalendarDays(from, MAX_RANGE_DAYS) <= to) {
    return "too_long";
  }
  return null;
}
