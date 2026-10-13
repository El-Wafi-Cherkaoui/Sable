import { describe, expect, it, vi } from "vitest";
import type { KeyInput } from "../input/terminal-key-input.js";
import { renderNoticeDialog, runNoticeDialog } from "./notice-dialog.js";
import { visibleLength } from "./width.js";

function keys(...sequence: Array<{ name?: string; sequence?: string; ctrl?: boolean }>): KeyInput {
  const queue = [...sequence];

  return {
    async readKey() {
      const next = queue.shift();

      if (next === undefined) {
        throw new Error("No key was provided for this test.");
      }

      return next;
    },
    close() {},
  };
}

const options = { title: "Your workspaces were upgraded", paragraphs: ["A long first paragraph that needs to be wrapped inside the box because it is far wider than the terminal.", "", "Second one."] };

describe("renderNoticeDialog", () => {
  it("draws a titled box with the wrapped text and an OK button, never wider than the terminal", () => {
    for (const columns of [80, 40]) {
      const rendered = renderNoticeDialog(options, undefined, columns, 24);

      expect(rendered).toContain("Your workspaces were upgraded");
      expect(rendered).toContain("OK");
      expect(rendered).toContain("Second one.");
      expect(rendered.split("\n").every((line) => visibleLength(line) < columns)).toBe(true);
      expect(rendered.replace(/[│╭╰╮╯─\s]+/g, " ")).toContain("wrapped inside the box");
    }
  });
});

describe("runNoticeDialog", () => {
  const screen = () => ({ clear: vi.fn(), write: vi.fn() });

  it("closes with Enter, Esc or q", async () => {
    for (const key of [{ name: "return" }, { name: "escape" }, { sequence: "q" }]) {
      await expect(runNoticeDialog({ ...options, keyInput: keys(key), screen: screen(), columns: 80, rows: 24 })).resolves.toBe("ok");
    }
  });

  it("ignores other keys, redraws on resize, and quits on Ctrl+C", async () => {
    const out = screen();

    await expect(runNoticeDialog({ ...options, keyInput: keys({ sequence: "x" }, { name: "resize" }, { name: "c", ctrl: true }), screen: out, columns: 80, rows: 24 })).resolves.toBe("exit");
    expect(out.write).toHaveBeenCalledTimes(2);
  });
});
