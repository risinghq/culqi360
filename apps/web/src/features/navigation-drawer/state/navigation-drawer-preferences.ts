import { booleanCodec, defineUiPreference } from "~/browser/ui/ui-preference";

export const navigationDrawerExpanded = defineUiPreference(
  "navigation_drawer_expanded",
  booleanCodec,
);

export const navigationDrawerAdvancedMode = defineUiPreference(
  "navigation_drawer_advanced_mode",
  booleanCodec,
);
