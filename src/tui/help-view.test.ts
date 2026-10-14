import { describe, expect, it } from "vitest";
import { renderHelpView } from "./help-view.js";
import { stripAnsi, visibleLength } from "./width.js";

describe("renderHelpView", () => {
  it("renders dashboard help in a titled box with the 0.3 keys only", () => {
    const rendered = renderHelpView("dashboard");

    expect(rendered).toContain("╭─ Help · workspace ─");
    expect(rendered).toContain("│  s           start (or run) / stop selected item");
    expect(rendered).toContain("a           add a service or command");
    expect(rendered).toContain("m           move selected service (↑ ↓, then Enter)");
    expect(rendered).toContain("Esc, q      back");
    expect(rendered.split("\n").at(-1)!.trim()).toBe("[Esc] close");
    expect(rendered).toContain("S           start every service, in order of 'After'");
    expect(rendered).not.toContain("command mode");
  });

  it("renders logs help", () => {
    const rendered = renderHelpView("logs");

    expect(rendered).toContain("╭─ Help · logs ─");
    expect(rendered).toContain("/           search, then Enter");
    expect(rendered).toContain("e           jump to the next error (stderr) line");
    expect(rendered).toContain("g / Home    jump to top");
    expect(rendered).toContain("Esc, q      clear the search, or go back to the dashboard");
  });

  it("opens over the current screen, which stays visible and dimmed around the box", () => {
    const background = Array.from({ length: 30 }, (_, index) => `row ${index} ${"·".repeat(70)}`).join("\n");
    const rendered = renderHelpView("logs", { background, columns: 80, rows: 30, color: true });
    const lines = rendered.split("\n");

    expect(stripAnsi(lines[0]!)).toBe(`row 0 ${"·".repeat(70)}`);
    expect(lines[0]).toContain("\x1b[2m");

    const boxLine = lines.find((line) => line.includes("Help · logs"))!;

    expect(stripAnsi(boxLine)).toMatch(/^row \d+ ·+╭─ Help · logs ─+╮·+$/);
    expect(lines.every((line) => visibleLength(line) < 80)).toBe(true);
  });
});
