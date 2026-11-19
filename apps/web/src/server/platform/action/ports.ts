import type { DomainError } from "~/domain/errors";

import type { ActionObservation } from "./telemetry";

export type ServerFunctionPorts = {
  record: (row: ActionObservation) => void;
  report: (error: DomainError) => void;
  setRetryAfterHeader: (retryAfterSeconds: number) => void;
};
