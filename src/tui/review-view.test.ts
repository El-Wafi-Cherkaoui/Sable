import { describe, expect, it, vi } from "vitest";
import type { KeyInput } from "../input/terminal-key-input.js";
import { renderReview, runReview, type ReviewLine } from "./review-view.js";
import { visibleLength } from "./width.js";

const base = { title: "Trust it?", confirmLabel: "trust and import" };
const lines = (count: number): ReviewLine[] => Array.from({ length: count }, (_, index) => ({ text: `line ${index + 1}` }));

describe("renderReview", () => {
  it("shows the title, the intro, the lines and the keys", () => {
    const { text } = renderReview({ ...base, intro: ["Read this first."], lines: [{ text: "run npm test" }] }, 0, undefined, 80, 20);
    const rows = text.split("\n");

    expect(rows[0]).toBe("Trust it?");
    expect(rows).toContain("Read this first.");
    expect(rows).toContain("run npm test");
    expect(rows.at(-1)).toBe("[Enter] trust and import  [↑↓] scroll  [Esc] not now");
    expect(rows).toHaveLength(19);
  });

  it("wraps a long line instead of cutting it off, so no part of a command is hidden", () => {
    const command = `npm run dev -- ${"--flag-with-a-long-name ".repeat(8)}--last-flag`;
    const { text } = renderReview({ ...base, lines: [{ text: `    run    ${command}` }] }, 0, undefined, 50, 24);
    const rows = text.split("\n");

    for (const row of rows) {
      expect(visibleLength(row)).toBeLessThan(50);
    }

    expect(rows.join("").replace(/\s+/g, "")).toContain(command.replace(/\s+/g, ""));
  });

  it("scrolls a long list and says how much is out of sight", () => {
    const first = renderReview({ ...base, lines: lines(40) }, 0, undefined, 80, 14);
    const middle = renderReview({ ...base, lines: lines(40) }, 10, undefined, 80, 14);
    const end = renderReview({ ...base, lines: lines(40) }, 999, undefined, 80, 14);

    expect(first.text).toContain("line 1");
    expect(first.text).toContain("↓ 3");
    expect(first.text).not.toContain("more above");
    expect(middle.text).toContain("line 11");
    expect(middle.text).toContain("↑ 10 more above · ↓");
    expect(end.text).toContain("line 40");
    expect(end.text).not.toContain("more below");
    expect(end.offset).toBe(end.maxOffset);
  });

  it("shows no scroll hint when everything fits", () => {
    expect(renderReview({ ...base, lines: lines(3) }, 0, undefined, 80, 30).text).not.toMatch(/more (above|below)/);
  });
});

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

describe("runReview", () => {
  const screen = () => ({ clear: vi.fn(), write: vi.fn() });

  it("confirms with Enter and cancels with Esc or q", async () => {
    await expect(runReview({ ...base, lines: lines(2), keyInput: keys({ name: "return" }), screen: screen(), columns: 80, rows: 20 })).resolves.toBe("confirm");
    await expect(runReview({ ...base, lines: lines(2), keyInput: keys({ name: "escape" }), screen: screen(), columns: 80, rows: 20 })).resolves.toBe("cancel");
    await expect(runReview({ ...base, lines: lines(2), keyInput: keys({ sequence: "q" }), screen: screen(), columns: 80, rows: 20 })).resolves.toBe("cancel");
  });

  it("leaves Sable on Ctrl+C", async () => {
    await expect(runReview({ ...base, lines: lines(2), keyInput: keys({ name: "c", ctrl: true }), screen: screen(), columns: 80, rows: 20 })).resolves.toBe("exit");
  });

  it("scrolls with the arrow keys, pages and Home/End, never past either end, and redraws after a resize", async () => {
    const out = screen();

    await runReview({
      ...base,
      lines: lines(40),
      keyInput: keys({ name: "up" }, { name: "down" }, { name: "down" }, { name: "pagedown" }, { name: "end" }, { name: "down" }, { name: "home" }, { name: "resize" }, { name: "return" }),
      screen: out,
      columns: 80,
      rows: 14,
    });

    const frames = out.write.mock.calls.map(([frame]) => String(frame));

    expect(frames[0]).toContain("line 1\n");
    expect(frames.some((frame) => frame.includes("line 40"))).toBe(true);
    expect(frames.at(-1)).toContain("line 1\n");
    expect(frames).toHaveLength(9);
  });
});
