import { describe, expect, it, vi } from "vitest";
import type { KeyInput } from "../input/terminal-key-input.js";
import { renderChecklist, runChecklist, type ChecklistItem } from "./checklist-view.js";

const items: ChecklistItem[] = [
  { label: "dev", detail: "vite", selected: true },
  { label: "build", detail: "vite build", note: "(one-shot)", selected: false },
];

describe("renderChecklist", () => {
  it("shows each item with its checkbox, details, and how many will be added", () => {
    expect(renderChecklist({ title: "shop", subtitle: "found package.json (npm)", question: "Add services?", items }, [true, false], 1)).toBe(
      [
        "shop · found package.json (npm)",
        "",
        "Add services?",
        "",
        "  [x] dev    vite",
        "> [ ] build  vite build  (one-shot)",
        "",
        "[↑↓] move  [Space] toggle  [Enter] add 1  [Esc] skip",
      ].join("\n"),
    );
  });

  describe("on a short terminal", () => {
    const many: ChecklistItem[] = Array.from({ length: 30 }, (_, index) => ({ label: `item ${index + 1}`, detail: "cmd", selected: false }));
    const draw = (focus: number, rows: number) => renderChecklist({ title: "shop", question: "Add?", items: many }, many.map(() => false), focus, undefined, false, 80, rows);

    it("never draws more lines than the terminal has", () => {
      for (const rows of [10, 14, 24]) {
        expect(draw(0, rows).split("\n").length).toBeLessThanOrEqual(rows - 1);
      }
    });

    it("keeps the focused row in view, and says how much is out of sight", () => {
      const top = draw(0, 14);
      const middle = draw(15, 14);
      const bottom = draw(29, 14);

      expect(top).toContain("> [ ] item 1 ");
      expect(top).toContain("↓ 2");
      expect(top).not.toMatch(/↑ \d+ more/);
      expect(middle).toContain("> [ ] item 16");
      expect(middle).toMatch(/↑ \d+ more · ↓ \d+ more/);
      expect(bottom).toContain("> [ ] item 30");
      expect(bottom).toMatch(/↑ \d+ more/);
      expect(bottom).not.toMatch(/↓ \d+ more/);
    });

    it("draws the whole list when it fits", () => {
      expect(draw(0, 60).split("\n").filter((line) => line.includes("[ ]"))).toHaveLength(30);
      expect(draw(0, 60)).not.toMatch(/more/);
    });
  });

  it("keeps a long title line inside the terminal width", () => {
    const first = renderChecklist({ title: "polyglot", subtitle: "found package.json (npm), Makefile, Docker Compose, Cargo.toml, go.mod, Django and pytest", question: "Add?", items }, [false, false], 0, undefined, false, 40).split("\n")[0]!;

    expect(first.length).toBeLessThan(40);
    expect(first.endsWith("...")).toBe(true);
  });

  it("offers to skip when nothing is checked", () => {
    expect(renderChecklist({ title: "shop", question: "Add?", items }, [false, false], 0)).toContain("[Enter] skip");
  });
});

describe("runChecklist", () => {
  it("toggles items with Space and submits with Enter", async () => {
    const result = await runChecklist({
      title: "shop",
      question: "Add?",
      items,
      keyInput: keys([{ name: "space", sequence: " " }, { name: "down" }, { name: "space", sequence: " " }, { name: "return" }]),
      screen: { clear: vi.fn(), write: vi.fn() },
      color: false,
    });

    expect(result).toEqual({ type: "submit", selected: [false, true] });
  });

  it("returns back on Escape and exit on Ctrl+C", async () => {
    const screen = { clear: vi.fn(), write: vi.fn() };

    await expect(runChecklist({ title: "s", question: "q", items, keyInput: keys([{ name: "escape" }]), screen, color: false })).resolves.toEqual({ type: "back" });
    await expect(runChecklist({ title: "s", question: "q", items, keyInput: keys([{ ctrl: true, name: "c" }]), screen, color: false })).resolves.toEqual({ type: "exit" });
  });
});

function keys(sequence: Array<{ sequence?: string; name?: string; ctrl?: boolean }>): KeyInput {
  return {
    async readKey() {
      const key = sequence.shift();

      if (key === undefined) {
        throw new Error("No key queued.");
      }

      return key;
    },
    close() {},
  };
}
