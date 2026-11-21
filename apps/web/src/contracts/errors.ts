const WIRE_KINDS = [
  "validation",
  "unauthenticated",
  "forbidden",
  "not_found",
  "conflict",
  "rate_limit",
  "internal",
] as const;

export type WireKind = (typeof WIRE_KINDS)[number];

type WireErrorBase = {
  code: string | null;
  message: string;
};

export type WireError = WireErrorBase &
  (
    | { kind: "rate_limit"; retryAfterSeconds?: number }
    | { kind: Exclude<WireKind, "rate_limit">; retryAfterSeconds?: never }
  );

const FALLBACK_MESSAGE = "Ocurrió un error inesperado.";

// wire is an own property, so it survives Seroval's Error serialization across
// the server-action boundary.
export class ActionError extends Error {
  readonly wire: WireError;

  constructor(wire: WireError) {
    super(wire.message);
    this.name = "ActionError";
    this.wire = wire;
  }
}

// A server function refused below the RPC layer (the CSRF check's 403, a host
// 5xx) carries no typed error. The client transport sets the HTTP status on
// the error it throws.
function wireForTransportStatus(status: number): WireError {
  if (status === 401) {
    return {
      kind: "unauthenticated",
      code: "session_expired",
      message: "Tu sesión expiró. Inicia sesión nuevamente.",
    };
  }

  if (status === 403) {
    return {
      kind: "forbidden",
      code: "request_security_rejected",
      message:
        "No se pudo verificar tu sesión de seguridad. Recarga la página e inténtalo otra vez.",
    };
  }

  return {
    kind: "internal",
    code: null,
    message: FALLBACK_MESSAGE,
  };
}

function isWireKind(value: unknown): value is WireKind {
  return WIRE_KINDS.some((kind) => kind === value);
}

function isWireError(value: unknown): value is WireError {
  if (!value || typeof value !== "object") {
    return false;
  }
  const kind = Reflect.get(value, "kind");
  const code = Reflect.get(value, "code");
  const message = Reflect.get(value, "message");
  const retryAfterSeconds = Reflect.get(value, "retryAfterSeconds");
  if (!isWireKind(kind)) {
    return false;
  }
  if (code !== null && typeof code !== "string") {
    return false;
  }
  if (typeof message !== "string") {
    return false;
  }
  return kind === "rate_limit"
    ? retryAfterSeconds === undefined || typeof retryAfterSeconds === "number"
    : retryAfterSeconds === undefined;
}

function carriedWire(error: unknown): WireError | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const wire = Reflect.get(error, "wire");
  return isWireError(wire) ? wire : undefined;
}

// Unknown failures use a generic message so server details are not exposed to the UI.
export function parseWireError(error: unknown): WireError {
  if (error instanceof ActionError) {
    return error.wire;
  }
  const wire = carriedWire(error);
  if (wire) {
    return wire;
  }
  const status = transportStatus(error);
  return status === undefined
    ? { kind: "internal", code: null, message: FALLBACK_MESSAGE }
    : wireForTransportStatus(status);
}

function transportStatus(error: unknown): number | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }
  const status = Reflect.get(error, "status");
  return typeof status === "number" ? status : undefined;
}

export function actionErrorMessage(error: unknown): string {
  return parseWireError(error).message;
}
