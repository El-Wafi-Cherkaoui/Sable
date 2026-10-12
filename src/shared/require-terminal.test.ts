import { describe, expect, it } from "vitest";
import { requireTerminal, TerminalRequiredError } from "./require-terminal.js";

describe("requireTerminal", () => {
  it("accepts a terminal on both input and output", () => {
    expect(() => requireTerminal({ stdin: { isTTY: true }, stdout: { isTTY: true } })).not.toThrow();
  });

  it("rejects piped input or output", () => {
    expect(() => requireTerminal({ stdin: {}, stdout: { isTTY: true } })).toThrow(TerminalRequiredError);
    expect(() => requireTerminal({ stdin: { isTTY: true }, stdout: { isTTY: false } })).toThrow(/interactive terminal/);
  });
});
