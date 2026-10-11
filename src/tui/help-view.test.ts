import { describe, expect, it } from "vitest";
import { renderHelpView } from "./help-view.js";

describe("renderHelpView", () => {
  it("renders dashboard help with the 0.3 keys only", () => {
    const rendered = renderHelpView("dashboard");

    expect(rendered).toContain("s           start or stop selected item");
    expect(rendered).toContain("r           restart service, or run command");
    expect(rendered).toContain("a           add a service or command");
    expect(rendered).toContain("m           move selected service (↑ ↓, then Enter)");
    expect(rendered).toContain("Enter       show logs or output");
    expect(rendered).toContain("Esc, q      back");
    expect(rendered).toContain("Esc, q, ?   close help");
    expect(rendered).not.toContain("S  ");
    expect(rendered).not.toContain("command mode");
  });

  it("renders logs help", () => {
    const rendered = renderHelpView("logs");

    expect(rendered).toContain("← / →       scroll long lines sideways");
    expect(rendered).toContain("g / Home    jump to top");
    expect(rendered).toContain("G / End     jump to bottom and follow");
    expect(rendered).toContain("Esc, q      back to dashboard");
    expect(rendered).not.toContain("command mode");
  });
});
