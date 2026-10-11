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
