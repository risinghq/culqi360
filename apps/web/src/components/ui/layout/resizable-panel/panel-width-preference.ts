import { defineUiPreference } from "~/browser/ui/ui-preference";

export type PanelWidthConstraints = {
  min: number;
  max: number;
  default: number;
};

export type PanelWidthPreference = {
  read: () => number;
  /** Clamps, stores, and returns the width the panel should take. */
  write: (width: number) => number;
};

export function definePanelWidthPreference(
  key: string,
  constraints: PanelWidthConstraints,
): PanelWidthPreference {
  const clamp = (width: number) =>
    Math.min(constraints.max, Math.max(constraints.min, width));
  const stored = defineUiPreference<number>(key, {
    decode(raw) {
      const parsed = Number.parseInt(raw, 10);
      return Number.isNaN(parsed) ? null : clamp(parsed);
    },
    encode: String,
  });

  return {
    read: () => stored.read() ?? constraints.default,
    write(width) {
      const clamped = clamp(width);
      stored.write(clamped);
      return clamped;
    },
  };
}
