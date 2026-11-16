import "~/instrument.server";
import { startMaintenanceWorker } from "~/server/entrypoints/worker/maintenance-worker";
import { runAsPlatform } from "~/server/platform/database/workspace-scope";

// Sweeps and queues span every workspace. Their timers and listeners keep the
// platform scope they start in; each queue job narrows it to its workspace.
const worker = runAsPlatform(startMaintenanceWorker);
let shutdown: Promise<void> | null = null;

function stopWorker(): Promise<void> {
  shutdown ??= worker.stop();
  return shutdown;
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void stopWorker().finally(() => process.exit(0));
  });
}
