export const ACTIVITY_CHANNELS = ["call", "visit"] as const;

export type ActivityChannelKey = (typeof ACTIVITY_CHANNELS)[number];

export const ACTIVITY_CHANNEL_LABELS: Readonly<
  Record<ActivityChannelKey, string>
> = {
  call: "Llamada",
  visit: "Visita",
};
