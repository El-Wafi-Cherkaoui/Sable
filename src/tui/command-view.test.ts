import { describe, expect, it } from "vitest";
import { parseCommand, renderCommandView } from "./command-view.js";

describe("renderCommandView", () => {
  it("renders the command prompt", () => {
    expect(renderCommandView({ input: "quit" })).toBe(
      ["Command", "", ":quit", "", "Enter run  Esc cancel"].join("\n"),
    );
  });

  it("renders command errors", () => {
    expect(renderCommandView({ input: "wat", error: "Unknown command: wat" })).toContain(
      "Unknown command: wat",
    );
  });
});

describe("parseCommand", () => {
  it("parses quit commands", () => {
    expect(parseCommand("q")).toEqual({ type: "quit" });
    expect(parseCommand(" quit ")).toEqual({ type: "quit" });
  });

  it("parses help commands", () => {
    expect(parseCommand("h")).toEqual({ type: "help" });
    expect(parseCommand(" HELP ")).toEqual({ type: "help" });
  });

  it("returns an unknown result for unsupported commands", () => {
    expect(parseCommand("wat")).toEqual({
      type: "unknown",
      message: "Unknown command: wat",
    });
  });
});
