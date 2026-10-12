import { describe, expect, it } from "vitest";
import { renderDialogBox, renderDialogScreen } from "./dialog-box.js";
import { plainStyle } from "./style.js";
import { visibleLength } from "./width.js";

describe("renderDialogBox", () => {
  it("draws a rounded box with the title in the top border and padding", () => {
    expect(renderDialogBox({ title: "Hello", lines: ["One line", "OK"], centered: [1], style: plainStyle })).toEqual([
      "╭─ Hello ─────╮",
      "│             │",
      "│  One line   │",
      "│     OK      │",
      "│             │",
      "╰─────────────╯",
    ]);
  });
});

describe("renderDialogScreen", () => {
  it("centers the box with hints under it", () => {
    const lines = renderDialogScreen({
      box: ["╭──╮", "╰──╯"],
      hints: "[Esc] close",
      style: plainStyle,
      columns: 20,
      rows: 9,
    }).split("\n");

    expect(lines.indexOf("        ╭──╮")).toBeGreaterThan(0);
    expect(lines.at(-1)).toBe("        [Esc] close");
  });

  it("never grows taller than the terminal, dropping the spacer first", () => {
    const box = Array.from({ length: 21 }, (_, index) => (index === 0 ? "╭──╮" : "│  │"));
    const lines = renderDialogScreen({ box, hints: "[Esc] close", style: plainStyle, columns: 40, rows: 23 }).split("\n");

    expect(lines).toHaveLength(22);
    expect(lines.at(-1)!.trim()).toBe("[Esc] close");
  });

  it("keeps the hint row under the box clear of the background", () => {
    const background = Array.from({ length: 9 }, () => "y".repeat(30)).join("\n");
    const lines = renderDialogScreen({ box: ["╭──╮", "╰──╯"], hints: "[Esc] close", style: plainStyle, columns: 30, rows: 10, background }).split("\n");

    expect(lines.find((line) => line.includes("[Esc] close"))).toBe(`${" ".repeat(13)}[Esc] close`);
  });

  it("cuts a background drawn for a wider terminal so it cannot wrap", () => {
    const background = Array.from({ length: 6 }, () => "x".repeat(60)).join("\n");
    const lines = renderDialogScreen({ box: ["╭──╮", "╰──╯"], style: plainStyle, columns: 30, rows: 7, background }).split("\n");

    expect(Math.max(...lines.map((line) => visibleLength(line)))).toBeLessThanOrEqual(30);
  });

  it("keeps the background visible around the box without passing the last column", () => {
    const background = Array.from({ length: 6 }, () => "x".repeat(30)).join("\n");
    const lines = renderDialogScreen({ box: ["╭──╮", "╰──╯"], style: plainStyle, columns: 30, rows: 7, background }).split("\n");

    expect(lines[0]).toBe("x".repeat(30));
    expect(lines.find((line) => line.includes("╭──╮"))).toBe(`${"x".repeat(13)}╭──╮${"x".repeat(12)}`);
    expect(lines.filter((line) => line.includes("╭") || line.includes("╰")).every((line) => visibleLength(line) < 30)).toBe(true);
  });
});
