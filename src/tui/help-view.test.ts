import { describe, expect, it } from "vitest";
import { renderHelpView } from "./help-view.js";

describe("renderHelpView", () => {
  it("renders dashboard help", () => {
    const rendered = renderHelpView("dashboard");

    expect(rendered).toContain("Dashboard");
    expect(rendered).toContain("S           start selected service");
    expect(rendered).toContain("d           delete selected non-running service");
    expect(rendered).toContain("K           move selected service up");
    expect(rendered).toContain("Enter       show selected service logs");
    expect(rendered).toContain(":           command mode");
    expect(rendered).toContain("Esc back  : command  q quit");
  });

  it("renders logs help", () => {
    const rendered = renderHelpView("logs");

    expect(rendered).toContain("Logs");
    expect(rendered).toContain("g           jump to top");
    expect(rendered).toContain("G           jump to bottom");
    expect(rendered).toContain("Esc         return to dashboard");
    expect(rendered).toContain(":           command mode");
  });
});
