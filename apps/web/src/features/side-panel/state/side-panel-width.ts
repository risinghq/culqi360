import { definePanelWidthPreference } from "~/components/ui/layout/resizable-panel/panel-width-preference";

export const SIDE_PANEL_WIDTH_VAR = "--side-panel-width";

export const SIDE_PANEL_WIDTH_CONSTRAINTS = {
  min: 320,
  max: 600,
  default: 400,
} as const;

export const sidePanelWidth = definePanelWidthPreference(
  "side_panel_width",
  SIDE_PANEL_WIDTH_CONSTRAINTS,
);
