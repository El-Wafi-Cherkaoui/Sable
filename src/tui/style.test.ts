import { describe, expect, it } from "vitest";
import { createTuiStyle, shouldUseColor } from "./style.js";

describe("shouldUseColor", () => {
  it("uses color for TTY output", () => {
    expect(shouldUseColor({ isTTY: true }, {})).toBe(true);
  });

  it("does not use color for non-TTY output", () => {
    expect(shouldUseColor({ isTTY: false }, {})).toBe(false);
  });

  it("respects NO_COLOR", () => {
    expect(shouldUseColor({ isTTY: true }, { NO_COLOR: "1" })).toBe(false);
  });

  it("allows FORCE_COLOR for non-TTY output", () => {
    expect(shouldUseColor({ isTTY: false }, { FORCE_COLOR: "1" })).toBe(true);
  });
});

describe("createTuiStyle", () => {
  it("returns plain text when disabled", () => {
    const style = createTuiStyle(false);

    expect(style.title("Sable")).toBe("Sable");
    expect(style.running("running")).toBe("running");
  });

  it("wraps semantic text when enabled", () => {
    const style = createTuiStyle(true);

    expect(style.title("Sable")).toBe("\x1b[1mSable\x1b[22m");
    expect(style.running("running")).toBe("\x1b[32mrunning\x1b[39m");
    expect(style.failed("failed")).toBe("\x1b[31mfailed\x1b[39m");
    expect(style.stream("stderr")).toBe("\x1b[31mstderr\x1b[39m");
  });
});
