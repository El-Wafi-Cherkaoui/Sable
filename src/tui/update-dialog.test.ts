import { describe, expect, it, vi } from "vitest";
import type { KeyInput } from "../input/terminal-key-input.js";
import { renderUpdateDialog, runUpdateDialog } from "./update-dialog.js";

const versions = { latestVersion: "0.4.0", currentVersion: "0.3.0", installCommand: "npm install -g sable-workspaces@latest" };

describe("renderUpdateDialog", () => {
  it("draws a centered box with both buttons and the command Update now runs", () => {
    const lines = renderUpdateDialog(versions, 1, undefined, 80).split("\n");
    const box = lines.filter((line) => line.includes("│") || line.includes("╭") || line.includes("╰"));

    expect(box[0]).toContain("╭─ Update available ─");
    expect(box.join("\n")).toContain("Sable 0.4.0 is available. You have 0.3.0.");
    expect(box.join("\n")).toContain("npm install -g sable-workspaces@latest");
    expect(box.join("\n")).toContain(" OK     [Update now]");
    expect(lines.at(-1)).toContain("[←→] choose  [Enter] select  [Esc] later");
    expect(new Set(box.map((line) => line.length)).size).toBe(1);
    expect(box[0]!.startsWith(" ")).toBe(true);
  });

  it("marks OK when it is selected", () => {
    expect(renderUpdateDialog(versions, 0, undefined, 80)).toContain("[OK]     Update now ");
  });
});

describe("runUpdateDialog", () => {
  it("has Update now selected by default", async () => {
    await expect(runUpdateDialog({ ...versions, keyInput: keys([{ name: "return" }]), screen: screen(), color: false })).resolves.toBe("update");
  });

  it("switches to OK with the arrow keys", async () => {
    await expect(runUpdateDialog({ ...versions, keyInput: keys([{ name: "left" }, { name: "return" }]), screen: screen(), color: false })).resolves.toBe("ok");
  });

  it("treats Escape and q as later, and Ctrl+C as quitting Sable", async () => {
    await expect(runUpdateDialog({ ...versions, keyInput: keys([{ name: "escape" }]), screen: screen(), color: false })).resolves.toBe("ok");
    await expect(runUpdateDialog({ ...versions, keyInput: keys([{ sequence: "q" }]), screen: screen(), color: false })).resolves.toBe("ok");
    await expect(runUpdateDialog({ ...versions, keyInput: keys([{ ctrl: true, name: "c" }]), screen: screen(), color: false })).resolves.toBe("exit");
  });
});

function screen() {
  return { clear: vi.fn(), write: vi.fn() };
}

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
