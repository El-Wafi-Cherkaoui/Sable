import { describe, expect, it } from "vitest";
import { padVisibleEnd, sliceVisibleStart, stripAnsi, truncateVisible, visibleLength } from "./width.js";

describe("terminal display width helpers", () => {
  it("measures wide unicode characters by display width", () => {
    expect(visibleLength("api")).toBe(3);
    expect(visibleLength("\u6e2c\u8a66")).toBe(4);
    expect(visibleLength("\x1b[1m\u6e2c\u8a66\x1b[22m")).toBe(4);
  });

  it("pads strings to display width", () => {
    const padded = padVisibleEnd("\u6e2c", 4);

    expect(visibleLength(padded)).toBe(4);
    expect(padded).toBe("\u6e2c  ");
  });

  it("truncates strings to display width", () => {
    const truncated = truncateVisible("\u6e2c\u8a66abc", 5);

    expect(stripAnsi(truncated)).toBe("\u6e2c...");
    expect(visibleLength(truncated)).toBe(5);
  });
  it("slices strings from a display-width offset", () => {
    expect(sliceVisibleStart("abcdef", 2)).toBe("cdef");
    expect(sliceVisibleStart("\u6e2c\u8a66abc", 2)).toBe("\u8a66abc");
  });
});