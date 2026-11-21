import { describe, expect, it } from "vitest";

import { securityHeaders } from "~/server/platform/http/security-headers";

const DSN = "https://key@o123.ingest.us.sentry.io/456";

function directives(csp: string | undefined): Map<string, string> {
  return new Map(
    (csp ?? "").split("; ").map((directive) => {
      const [name = "", ...values] = directive.split(" ");
      return [name, values.join(" ")];
    }),
  );
}

describe("securityHeaders", () => {
  it("allows only same-origin scripts in a build", () => {
    const csp = directives(
      securityHeaders({ development: false, browserSentryDsn: "" })[
        "Content-Security-Policy"
      ],
    );

    expect(csp.get("script-src")).toBe("'self'");
    expect(csp.get("worker-src")).toBe("'self' blob:");
    expect(csp.get("connect-src")).toBe("'self'");
    expect(csp.get("frame-ancestors")).toBe("'none'");
  });

  it("lets the browser reach the Sentry host of its own DSN", () => {
    const csp = directives(
      securityHeaders({ development: false, browserSentryDsn: DSN })[
        "Content-Security-Policy"
      ],
    );

    expect(csp.get("connect-src")).toBe(
      "'self' https://o123.ingest.us.sentry.io",
    );
  });

  it("relaxes scripts and drops HSTS in development", () => {
    const headers = securityHeaders({
      development: true,
      browserSentryDsn: "",
    });

    expect(
      directives(headers["Content-Security-Policy"]).get("script-src"),
    ).toBe("'self' 'unsafe-inline' 'unsafe-eval'");
    expect(headers["Strict-Transport-Security"]).toBeUndefined();
  });

  it("sends HSTS from a build", () => {
    const headers = securityHeaders({
      development: false,
      browserSentryDsn: "",
    });
    expect(headers["Strict-Transport-Security"]).toContain("max-age=");
  });

  it("ignores a malformed DSN", () => {
    const csp = directives(
      securityHeaders({ development: false, browserSentryDsn: "not a url" })[
        "Content-Security-Policy"
      ],
    );
    expect(csp.get("connect-src")).toBe("'self'");
  });
});
