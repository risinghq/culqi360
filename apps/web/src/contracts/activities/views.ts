export type ActivityChannelView = "call" | "visit";

export type OutcomeView = {
  id: string;
  label: string;
  channel: ActivityChannelView;
  contacted: boolean | null;
  negotiated: boolean | null;
  callback: boolean | null;
};
