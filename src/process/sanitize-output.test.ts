import { describe, expect, it } from "vitest";
import { sanitizeLogLine } from "./sanitize-output.js";

describe("sanitizeLogLine", () => {
  it("leaves plain text and tabs alone", () => {
    expect(sanitizeLogLine("ready\tin 12ms")).toBe("ready\tin 12ms");
  });

  it("keeps SGR color codes", () => {
    const colored = "\x1b[1;31merror\x1b[0m \x1b[38;5;196mred\x1b[m \x1b[38:2::255:0:0mtrue\x1b[0m";

    expect(sanitizeLogLine(colored)).toBe(colored);
  });

  it.each([
    ["screen clear", "\x1b[2Jbuilt", "built"],
    ["cursor move", "\x1b[1;1Hbuilt", "built"],
    ["alternate screen", "\x1b[?1049hbuilt", "built"],
    ["erase line", "\x1b[2Kbuilt", "built"],
    ["cursor up", "\x1b[1Abuilt", "built"],
    ["full reset", "\x1bcbuilt", "built"],
    ["save cursor", "\x1b7built\x1b8", "built"],
    ["charset select", "\x1b(Bbuilt", "built"],
    ["OSC title ended by BEL", "\x1b]0;my title\x07built", "built"],
    ["OSC title ended by ST", "\x1b]2;my title\x1b\\built", "built"],
    ["unterminated OSC", "built\x1b]0;my ti", "built"],
    ["incomplete CSI", "built\x1b[12", "built"],
    ["lone escape", "built\x1b", "built"],
    ["SGR with a private marker", "\x1b[?25mbuilt", "built"],
  ])("drops %s", (_name, input, expected) => {
    expect(sanitizeLogLine(input)).toBe(expected);
  });

  it("keeps colors next to dropped sequences", () => {
    expect(sanitizeLogLine("\x1b[2J\x1b[32mok\x1b[0m\x1b[K")).toBe("\x1b[32mok\x1b[0m");
  });

  it("drops control characters", () => {
    expect(sanitizeLogLine("a\x00b\x07c\x08d\x7fe\x9bf")).toBe("abcdef");
  });

  it("keeps only the last segment of a carriage-return progress line", () => {
    expect(sanitizeLogLine("10%\r50%\r100% done")).toBe("100% done");
    expect(sanitizeLogLine("done\r")).toBe("done");
    expect(sanitizeLogLine("\r\r")).toBe("");
  });
});
