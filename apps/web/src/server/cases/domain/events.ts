// What happened to a case, in the order it happened. An import writes no
// events: the history starts at the first change made in the app. An action
// is a module's own event, named by the module and read by its timeline.
export type CaseEventKind =
  | "opened"
  | "stage_written"
  | "reassigned"
  | "timed_out"
  | "action";
