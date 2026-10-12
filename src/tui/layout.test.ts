import { describe, expect, it } from "vitest";
import { clipLines } from "./layout.js";
import { visibleLength } from "./width.js";

describe("clipLines", () => {
  it("cuts each line to leave the last column free", () => {
    expect(clipLines(["short", "x".repeat(30)].join("\n"), 20).split("\n")).toEqual(["short", `${"x".repeat(16)}...`]);
  });

  it("keeps colors and measures only what is visible", () => {
    const clipped = clipLines(`\x1b[32m${"x".repeat(30)}\x1b[0m`, 20);

    expect(visibleLength(clipped)).toBe(19);
    expect(clipped).toContain("\x1b[32m");
  });

  it("leaves the text alone when the width is unknown", () => {
    expect(clipLines("x".repeat(300), undefined)).toBe("x".repeat(300));
  });
});
