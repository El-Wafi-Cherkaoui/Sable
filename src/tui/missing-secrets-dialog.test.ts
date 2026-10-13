import { describe, expect, it, vi } from "vitest";
import type { KeyInput } from "../input/terminal-key-input.js";
import { renderMissingSecretsDialog, runMissingSecretsDialog } from "./missing-secrets-dialog.js";
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

const options = { itemName: "api", missing: ["STRIPE_KEY", "DATABASE_URL"] };

describe("renderMissingSecretsDialog", () => {
  it("names the item and each missing variable, and explains why the file leaves them out", () => {
    const rendered = renderMissingSecretsDialog(options, undefined, 80, 24);

    expect(rendered).toContain("Missing secret");
    expect(rendered).toContain("api needs 2 variables that aren't set on this machine:");
    expect(rendered).toContain("STRIPE_KEY");
    expect(rendered).toContain("DATABASE_URL");
    expect(rendered).toContain("each person sets their own");
    expect(rendered).toContain("[Enter] set now  [e] edit the whole item  [Esc] cancel");
  });

  it("speaks of one variable in the singular", () => {
    expect(renderMissingSecretsDialog({ itemName: "api", missing: ["TOKEN"] }, undefined, 80, 24)).toContain("api needs a variable that isn't set on this machine:");
  });

  it("never gets wider than a narrow terminal", () => {
    expect(renderMissingSecretsDialog(options, undefined, 40, 24).split("\n").every((line) => visibleLength(line) < 40)).toBe(true);
  });
});

describe("runMissingSecretsDialog", () => {
  const screen = () => ({ clear: vi.fn(), write: vi.fn() });
  const open = (...sequence: Parameters<typeof keys>) => runMissingSecretsDialog({ ...options, keyInput: keys(...sequence), screen: screen(), columns: 80, rows: 24 });

  it("sets them now with Enter, edits the item with e, and cancels with Esc or q", async () => {
    await expect(open({ name: "return" })).resolves.toBe("fill");
    await expect(open({ sequence: "e" })).resolves.toBe("edit");
    await expect(open({ name: "escape" })).resolves.toBe("cancel");
    await expect(open({ sequence: "q" })).resolves.toBe("cancel");
  });

  it("ignores other keys, redraws on resize, and quits Sable on Ctrl+C", async () => {
    const out = screen();

    await expect(runMissingSecretsDialog({ ...options, keyInput: keys({ sequence: "x" }, { name: "resize" }, { name: "c", ctrl: true }), screen: out, columns: 80, rows: 24 })).resolves.toBe("exit");
    expect(out.write).toHaveBeenCalledTimes(2);
  });
});
