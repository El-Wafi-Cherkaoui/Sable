import { describe, expect, it, vi } from "vitest";
import type { KeyInput } from "../input/terminal-key-input.js";
import { applyFormKey, renderForm, runForm, type FormField, type FormState, type FormValues } from "./form-view.js";

const fields = (values: FormValues): FormField[] => [
  { type: "choice", key: "type", label: "Type", choices: [{ value: "service", label: "service" }, { value: "command", label: "command" }] },
  { type: "text", key: "name", label: "Name", hint: "Shown in the dashboard" },
  ...(values.type === "service" ? [{ type: "toggle" as const, key: "autoStart", label: "Auto-start" }] : []),
  { type: "list", key: "env", label: "Env", addLabel: "add variable" },
];
const values: FormValues = { type: "service", name: "api", autoStart: true, env: ["PORT=3000"] };

describe("applyFormKey", () => {
  it("edits text at the cursor and moves between fields", () => {
    let state = stateAt(1, 3);

    state = applyFormKey({ fields }, state, { sequence: "s" });
    state = applyFormKey({ fields }, state, { name: "left" });
    state = applyFormKey({ fields }, state, { name: "backspace" });

    expect(state.values.name).toBe("aps");
    expect(applyFormKey({ fields }, state, { name: "down" }).focus).toBe(2);
    expect(applyFormKey({ fields }, state, { name: "up" }).focus).toBe(0);
  });

  it("switches toggles and choices with Space or arrows", () => {
    expect(applyFormKey({ fields }, stateAt(2), { name: "space", sequence: " " }).values.autoStart).toBe(false);
    expect(applyFormKey({ fields }, stateAt(0), { name: "right" }).values.type).toBe("command");
  });

  it("hides fields that do not apply to the current choice", () => {
    const state = applyFormKey({ fields }, stateAt(0), { name: "right" });

    expect(renderForm({ title: "New", fields }, state)).not.toContain("Auto-start");
  });

  it("adds list items with Enter and removes empty ones with Backspace", () => {
    const added = applyFormKey({ fields }, stateAt(4), { name: "return" });

    expect(added.values.env).toEqual(["PORT=3000", ""]);

    const typed = applyFormKey({ fields }, added, { sequence: "X" });

    expect(typed.values.env).toEqual(["PORT=3000", "X"]);

    const removed = applyFormKey({ fields }, { ...added, cursor: 0 }, { name: "backspace" });

    expect(removed.values.env).toEqual(["PORT=3000"]);
    expect(removed.focus).toBe(3);
  });

  it("keeps a pasted chunk of text together", () => {
    const state = applyFormKey({ fields }, stateAt(1, 3), { sequence: "-server" });

    expect(state.values.name).toBe("api-server");
    expect(state.cursor).toBe(10);
  });
});

describe("renderForm", () => {
  it("shows every field, marks the focused one, and shows its hint", () => {
    expect(renderForm({ title: "New service", subtitle: "shop", fields }, stateAt(1, 3))).toBe(
      [
        "New service · shop",
        "",
        "  Type        service / command",
        "> Name        api▏",
        "              Shown in the dashboard",
        "  Auto-start  yes",
        "  Env         PORT=3000",
        "              + add variable",
        "",
        "[↑↓] field  [Ctrl+S] save  [Esc] cancel",
      ].join("\n"),
    );
  });

  it("shows validation errors under their fields", () => {
    const rendered = renderForm({ title: "New", fields }, { ...stateAt(1), errors: { name: "Name is required.", "env.0": "Use KEY=value." } });

    expect(rendered).toContain("              Name is required.");
    expect(rendered).toContain("              Use KEY=value.");
  });
});

describe("runForm", () => {
  it("submits with Ctrl+S and drops blank list items", async () => {
    const result = await runForm({
      title: "New",
      fields,
      values: { ...values, env: ["PORT=3000", "  "] },
      keyInput: keys([{ ctrl: true, name: "s" }]),
      screen: { clear: vi.fn(), write: vi.fn() },
      color: false,
    });

    expect(result).toEqual({ type: "submit", values: { ...values, env: ["PORT=3000"] } });
  });

  it("submits with Enter on the last field", async () => {
    const result = await runForm({
      title: "New",
      fields: () => [{ type: "text", key: "name", label: "Name" }],
      values: { name: "x" },
      keyInput: keys([{ name: "return" }]),
      screen: { clear: vi.fn(), write: vi.fn() },
      color: false,
    });

    expect(result).toEqual({ type: "submit", values: { name: "x" } });
  });

  it("stays open and focuses the first invalid field until it is fixed", async () => {
    const write = vi.fn();
    const result = await runForm({
      title: "New",
      fields,
      values: { ...values, name: "" },
      validate: (current) => (current.name === "" ? { name: "Name is required." } : {}),
      keyInput: keys([{ name: "down" }, { name: "down" }, { ctrl: true, name: "s" }, { sequence: "w" }, { ctrl: true, name: "s" }]),
      screen: { clear: vi.fn(), write },
      color: false,
    });

    expect(write.mock.calls.map(([contents]) => contents).join("")).toContain("Name is required.");
    expect(result).toEqual({ type: "submit", values: { ...values, name: "w" } });
  });

  it("returns back on Escape and exit on Ctrl+C", async () => {
    const screen = { clear: vi.fn(), write: vi.fn() };

    await expect(runForm({ title: "New", fields, values, keyInput: keys([{ name: "escape" }]), screen, color: false })).resolves.toEqual({ type: "back" });
    await expect(runForm({ title: "New", fields, values, keyInput: keys([{ ctrl: true, name: "c" }]), screen, color: false })).resolves.toEqual({ type: "exit" });
  });
});

function stateAt(focus: number, cursor = 0): FormState {
  return { values, focus, cursor, errors: {} };
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
