import { defineUiPreference, oneOfCodec } from "~/browser/ui/ui-preference";

export type ThemeMode = "light" | "dark";

const themeModePreference = defineUiPreference(
  "crm-theme-mode",
  oneOfCodec<ThemeMode>(["light", "dark"]),
);

export function readThemeMode(): ThemeMode {
  return themeModePreference.read() ?? "light";
}

export function applyThemeMode(theme: ThemeMode): void {
  document.documentElement.setAttribute("data-theme", theme);
}

export function saveThemeMode(theme: ThemeMode): void {
  themeModePreference.write(theme);
}
