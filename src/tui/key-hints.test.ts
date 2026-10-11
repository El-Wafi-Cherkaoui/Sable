import { describe, expect, it } from "vitest";
import { formatKeyHints } from "./key-hints.js";
import { createTuiStyle, plainStyle } from "./style.js";

describe("formatKeyHints", () => {
  const hints = [["s", "start"], ["Enter", "logs"], ["e", "edit"], ["q", "back"]] as const;

  it("renders keys as chips with labels", () => {
    expect(formatKeyHints(hints, plainStyle)).toBe("[s] start  [Enter] logs  [e] edit  [q] back");
    expect(formatKeyHints([["s", "start"]], createTuiStyle(true))).toBe("\x1b[48;5;252m\x1b[38;5;235m\x1b[1m s \x1b[22m\x1b[39m\x1b[49m \x1b[2mstart\x1b[22m");
  });

  it("drops hints before the last one until the row fits", () => {
    expect(formatKeyHints(hints, plainStyle, 33)).toBe("[s] start  [Enter] logs  [q] back");
    expect(formatKeyHints(hints, plainStyle, 30)).toBe("[s] start  [q] back");
    expect(formatKeyHints(hints, plainStyle, 10)).toBe("[q] back");
  });
});
