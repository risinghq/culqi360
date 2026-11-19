import type { Accessor } from "solid-js";

import { isMac } from "./hotkey-utils";

export function useModKeyLabel(): Accessor<string> {
  const label = isMac() ? "⌘" : "Ctrl";
  return () => label;
}
