import { describe, expect, it, vi } from "vitest";
import type { KeyInput } from "../input/terminal-key-input.js";
import { formatBytes, renderSavedLogsDialog, runSavedLogsDialog, type SavedLogRow } from "./saved-logs-dialog.js";
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

const initial: SavedLogRow[] = [
  { label: "Everything in this workspace", bytes: 5300 },
  { label: "api", bytes: 3_200_000 },
  { label: "build (command)", bytes: 0 },
];

function setup(start: SavedLogRow[] = initial) {
  let rows = start.map((row) => ({ ...row }));
  const removed: number[] = [];
  const frames: string[] = [];
  const open = (...sequence: Parameters<typeof keys>) => runSavedLogsDialog({
    title: "Saved logs · stack",
    load: async () => rows.map((row) => ({ ...row })),
    remove: async (index) => {
      removed.push(index);
      rows = rows.map((row, at) => at === index || index === 0 ? { ...row, bytes: 0 } : row);
    },
    keyInput: keys(...sequence),
    screen: { clear: vi.fn(), write: (frame: string) => frames.push(frame) },
    columns: 80,
    rows: 24,
  });

  return { open, removed, frames };
}

describe("formatBytes", () => {
  it("writes sizes the way people read them", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(900)).toBe("900 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(20_000)).toBe("20 KB");
    expect(formatBytes(3_200_000)).toBe("3.1 MB");
    expect(formatBytes(5 * 1024 ** 3)).toBe("5 GB");
  });
});

describe("renderSavedLogsDialog", () => {
  const state = { rows: initial, selected: 1, confirming: false };

  it("lists each row with its size, marks the selected one, and says when nothing is saved", () => {
    const rendered = renderSavedLogsDialog({ title: "Saved logs · stack" }, state, undefined, 80, 24);

    expect(rendered).toContain("Saved logs · stack");
    expect(rendered).toContain("  Everything in this workspace   5.2 KB");
    expect(rendered).toMatch(/> api\s+3\.1 MB/);
    expect(rendered).toMatch(/ {2}build \(command\)\s+nothing saved/);
    expect(rendered).toContain("[d] delete");
  });

  it("asks before deleting, naming what goes and how big it is", () => {
    const rendered = renderSavedLogsDialog({ title: "Saved logs" }, { ...state, confirming: true }, undefined, 80, 24);

    expect(rendered).toContain("Delete the saved logs of api (3.1 MB)?");
    expect(rendered).toContain("[Enter] delete  [Esc] keep");
  });

  it("shows a note under the list, and a message after a delete in its place", () => {
    expect(renderSavedLogsDialog({ title: "x", note: "Saving logs is off." }, state, undefined, 80, 24)).toContain("Saving logs is off.");
    expect(renderSavedLogsDialog({ title: "x", note: "Saving logs is off." }, { ...state, message: "Deleted." }, undefined, 80, 24)).not.toContain("Saving logs is off.");
  });

  it("scrolls a long list inside the terminal and never gets wider than it", () => {
    const many = Array.from({ length: 40 }, (_, index) => ({ label: `worker-with-a-long-name-${index}`, bytes: 1000 + index }));

    for (const columns of [80, 40]) {
      const rendered = renderSavedLogsDialog({ title: "Saved logs" }, { rows: many, selected: 20, confirming: false }, undefined, columns, 24);

      expect(rendered.split("\n").length).toBeLessThanOrEqual(23);
      expect(rendered).toContain("worker-with-a-long-name-20");
      expect(rendered).toMatch(/↑ \d+ more · ↓ \d+ more/);
      expect(rendered.split("\n").every((line) => visibleLength(line) < columns)).toBe(true);
    }
  });
});

describe("runSavedLogsDialog", () => {
  it("closes with Esc or q and leaves Sable on Ctrl+C", async () => {
    await expect(setup().open({ name: "escape" })).resolves.toBe("close");
    await expect(setup().open({ sequence: "q" })).resolves.toBe("close");
    await expect(setup().open({ name: "c", ctrl: true })).resolves.toBe("exit");
  });

  it("deletes the selected row only after a second step, then shows the new size", async () => {
    const { open, removed, frames } = setup();

    await open({ name: "down" }, { sequence: "d" }, { name: "return" }, { name: "escape" });

    expect(removed).toEqual([1]);
    expect(frames.at(-1)).toMatch(/> api\s+nothing saved/);
    expect(frames.at(-1)).toContain("Deleted the saved logs of api.");
    expect(frames.some((frame) => frame.includes("Delete the saved logs of api (3.1 MB)?"))).toBe(true);
  });

  it("keeps everything when the user backs out of the question", async () => {
    const { open, removed } = setup();

    await open({ name: "down" }, { name: "return" }, { name: "escape" }, { name: "escape" });

    expect(removed).toEqual([]);
  });

  it("ignores other keys while asking, so a stray key cannot delete", async () => {
    const { open, removed } = setup();

    await open({ name: "down" }, { sequence: "d" }, { sequence: "x" }, { name: "down" }, { name: "escape" }, { name: "escape" });

    expect(removed).toEqual([]);
  });

  it("says so, without asking, when nothing is saved for a row", async () => {
    const { open, removed, frames } = setup();

    await open({ name: "down" }, { name: "down" }, { sequence: "d" }, { name: "escape" });

    expect(removed).toEqual([]);
    expect(frames.at(-1)).toContain("Nothing is saved for build (command).");
  });

  it("deletes everything from the first row, and wraps the selection around the list", async () => {
    const { open, removed } = setup();

    await open({ name: "up" }, { name: "down" }, { name: "return" }, { name: "return" }, { name: "escape" });

    expect(removed).toEqual([0]);
  });
});
