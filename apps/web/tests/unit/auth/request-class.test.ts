import { describe, expect, it } from "vitest";

import { classifyRequest } from "~/server/platform/http/request-class";

describe("classifyRequest", () => {
  it("classifies provider webhooks as machine", () => {
    expect(classifyRequest("/api/webhooks/whatsapp")).toBe("machine");
  });

  it("classifies the sign-in API as public", () => {
    expect(classifyRequest("/api/auth")).toBe("public_api");
    expect(classifyRequest("/api/auth/google")).toBe("public_api");
    expect(classifyRequest("/api/authx")).toBe("api");
  });

  it("classifies every other API route as api", () => {
    expect(classifyRequest("/api/me/avatar")).toBe("api");
    expect(classifyRequest("/api/extension/handoff-token")).toBe("api");
  });

  it("classifies the server-function endpoint", () => {
    expect(classifyRequest("/_server")).toBe("server_function");
    expect(classifyRequest("/_server/")).toBe("server_function");
    expect(classifyRequest("/_serverx")).toBe("page");
  });

  it("classifies everything else as a page", () => {
    expect(classifyRequest("/")).toBe("page");
    expect(classifyRequest("/records")).toBe("page");
    expect(classifyRequest("/login")).toBe("page");
    expect(classifyRequest("/reports/export.csv")).toBe("page");
  });
});
