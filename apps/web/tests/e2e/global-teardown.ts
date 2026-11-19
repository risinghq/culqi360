import { rmSync } from "node:fs";

import { E2E_DATA_ROOT } from "./data";

export default function globalTeardown(): void {
  rmSync(E2E_DATA_ROOT, { recursive: true, force: true });
}
