import { describe, expect, it, vi } from "vitest";
import type { KeyInput } from "../input/terminal-key-input.js";
import { renderDeleteDialog, runDeleteDialog } from "./delete-dialog.js";

const base = {
  title: "Delete workspace",
  explanation: ['This removes "shop" and its 2 services from Sable.', "Your project files stay untouched."],
  name: "shop",
  columns: 80,
  rows: 20,
};

describe("renderDeleteDialog", () => {
  it("explains what is removed and asks for the name inside the box", () => {
    const rendered = renderDeleteDialog(base, "sh", undefined);

    expect(rendered).toContain("╭─ Delete workspace ─");
    expect(rendered).toContain('│  This removes "shop" and its 2 services from Sable.');
    expect(rendered).toContain("│  Type shop to confirm:");
    expect(rendered).toContain("│  sh▏");
    expect(rendered.split("\n").at(-1)!.trim()).toBe("[Enter] delete  [Esc] cancel");
  });

  it("keeps the same size when an error appears", () => {
    const withoutError = renderDeleteDialog(base, "x", undefined).split("\n");
    const withError = renderDeleteDialog(base, "x", 'That doesn\'t match "shop".').split("\n");

    expect(withError).toHaveLength(withoutError.length);
    expect(withError.join("\n")).toContain('That doesn\'t match "shop".');
  });
});

describe("runDeleteDialog", () => {
  it("confirms only when the name matches exactly", async () => {
    const write = vi.fn();
    const result = await runDeleteDialog({
      ...base,
      keyInput: keys([..."SHOP"].map((sequence) => ({ sequence })).concat([{ name: "return" } as never])
        .concat(Array.from({ length: 4 }, () => ({ name: "backspace" }) as never))
        .concat([..."shop"].map((sequence) => ({ sequence }) as never))
        .concat([{ name: "return" } as never])),
      screen: { clear: vi.fn(), write },
      color: false,
    });

    expect(write.mock.calls.map(([frame]) => frame).join("")).toContain('That doesn\'t match "shop".');
    expect(result).toBe("confirm");
  });

  it("cancels on Escape and quits on Ctrl+C", async () => {
    const screen = { clear: vi.fn(), write: vi.fn() };

    await expect(runDeleteDialog({ ...base, keyInput: keys([{ name: "escape" }]), screen, color: false })).resolves.toBe("back");
    await expect(runDeleteDialog({ ...base, keyInput: keys([{ ctrl: true, name: "c" }]), screen, color: false })).resolves.toBe("exit");
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
