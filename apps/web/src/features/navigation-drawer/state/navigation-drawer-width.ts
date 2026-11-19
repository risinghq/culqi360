import { definePanelWidthPreference } from "~/components/ui/layout/resizable-panel/panel-width-preference";

export const NAVIGATION_DRAWER_WIDTH_VAR = "--navigation-drawer-width";

export const NAVIGATION_DRAWER_WIDTH_CONSTRAINTS = {
  min: 180,
  max: 350,
  default: 220,
} as const;

export const navigationDrawerWidth = definePanelWidthPreference(
  "navigation_drawer_width",
  NAVIGATION_DRAWER_WIDTH_CONSTRAINTS,
);
