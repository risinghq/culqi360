// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import { definePanelWidthPreference } from "~/components/ui/layout/resizable-panel/panel-width-preference";

const constraints = { min: 200, max: 400, default: 300 };

describe("definePanelWidthPreference", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("reads the default when nothing is stored", () => {
    const width = definePanelWidthPreference("width", constraints);

    expect(width.read()).toBe(300);
  });

  it("clamps what it writes and reads back the clamped value", () => {
    const width = definePanelWidthPreference("width", constraints);

    expect(width.write(999)).toBe(400);
    expect(width.read()).toBe(400);
  });

  it("clamps a stored value outside the bounds", () => {
    window.localStorage.setItem("width", "50");

    expect(definePanelWidthPreference("width", constraints).read()).toBe(200);
  });

  it("falls back to the default for a value that is not a number", () => {
    window.localStorage.setItem("width", "wide");

    expect(definePanelWidthPreference("width", constraints).read()).toBe(300);
  });

  it("keeps working when the browser blocks storage", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    const width = definePanelWidthPreference("width", constraints);

    expect(width.write(350)).toBe(350);
    expect(width.read()).toBe(300);
  });
});
