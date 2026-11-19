export function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "Unexpected application error";
}

export function reportBoundaryError(
  sink: { error: (message: string, meta?: Record<string, unknown>) => void },
  error: unknown,
) {
  sink.error("ui_boundary_error", {
    boundary: "app-root",
    error,
    browser: {
      path: window.location.pathname,
      search: window.location.search,
      hash: window.location.hash,
    },
  });
}
