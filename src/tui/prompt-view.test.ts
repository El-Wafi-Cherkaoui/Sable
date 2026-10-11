import { describe, expect, it, vi } from "vitest";
import type { KeyInput } from "../input/terminal-key-input.js";
import { runConfirmPrompt, runSelectPrompt, runTextPrompt } from "./prompt-view.js";

describe("runTextPrompt", () => {
  it("submits typed text", async () => {
    await expect(
      runTextPrompt({
        title: "Add service",
        message: "Service name",
        keyInput: createKeyInput([{ sequence: "a" }, { name: "return" }]),
        screen: createScreen(),
      }),
    ).resolves.toEqual({ type: "submit", value: "a" });
  });

  it("renders typed input with a subtle underline instead of a > marker", async () => {
    const screen = createScreen();

    await runTextPrompt({
      title: "Add service",
      message: "Service name",
      keyInput: createKeyInput([{ sequence: "a" }, { name: "return" }]),
      screen,
    });

    expect(screen.write).toHaveBeenCalledWith(expect.stringContaining("  a\n  ─\n   ^"));
    expect(screen.write).not.toHaveBeenCalledWith(expect.stringContaining("> a"));
  });

  it("inserts text at the cursor after moving left", async () => {
    await expect(
      runTextPrompt({
        title: "Add service",
        message: "Service name",
        keyInput: createKeyInput([
          { sequence: "a" },
          { sequence: "c" },
          { name: "left" },
          { sequence: "b" },
          { name: "return" },
        ]),
        screen: createScreen(),
      }),
    ).resolves.toEqual({ type: "submit", value: "abc" });
  });

  it("deletes before and at the cursor", async () => {
    await expect(
      runTextPrompt({
        title: "Add service",
        message: "Service name",
        keyInput: createKeyInput([
          { sequence: "a" },
          { sequence: "b" },
          { sequence: "x" },
          { sequence: "c" },
          { name: "left" },
          { name: "left" },
          { name: "delete" },
          { name: "backspace" },
          { sequence: "b" },
          { name: "return" },
        ]),
        screen: createScreen(),
      }),
    ).resolves.toEqual({ type: "submit", value: "abc" });
  });

  it("keeps cursor movement within input bounds", async () => {
    await expect(
      runTextPrompt({
        title: "Add service",
        message: "Service name",
        keyInput: createKeyInput([
          { name: "left" },
          { name: "backspace" },
          { sequence: "a" },
          { name: "right" },
          { name: "right" },
          { sequence: "b" },
          { name: "return" },
        ]),
        screen: createScreen(),
      }),
    ).resolves.toEqual({ type: "submit", value: "ab" });
  });

  it("moves between the start and end of a default value", async () => {
    await expect(
      runTextPrompt({
        title: "Rename workspace",
        message: "Workspace name",
        keyInput: createKeyInput([
          { name: "home" },
          { sequence: "a" },
          { name: "end" },
          { sequence: "z" },
          { name: "return" },
        ]),
        screen: createScreen(),
        defaultValue: "bc",
      }),
    ).resolves.toEqual({ type: "submit", value: "abcz" });
  });

  it("renders the cursor marker without changing the text input", async () => {
    const screen = createScreen();

    await runTextPrompt({
      title: "Add service",
      message: "Service name",
      keyInput: createKeyInput([{ sequence: "a" }, { sequence: "b" }, { name: "left" }, { name: "return" }]),
      screen,
    });

    expect(screen.write).toHaveBeenCalledWith(expect.stringContaining("  ab\n  ──\n   ^"));
  });

  it("returns back on Esc", async () => {
    await expect(
      runTextPrompt({
        title: "Add service",
        message: "Service name",
        keyInput: createKeyInput([{ name: "escape" }]),
        screen: createScreen(),
      }),
    ).resolves.toEqual({ type: "back" });
  });

  it("returns exit on Ctrl+C", async () => {
    await expect(
      runTextPrompt({
        title: "Add service",
        message: "Service name",
        keyInput: createKeyInput([{ name: "c", ctrl: true }]),
        screen: createScreen(),
      }),
    ).resolves.toEqual({ type: "exit" });
  });

  it("renders validation errors and stays in prompt", async () => {
    const screen = createScreen();

    await expect(
      runTextPrompt({
        title: "Add service",
        message: "Service name",
        keyInput: createKeyInput([{ name: "return" }, { sequence: "a" }, { name: "return" }]),
        screen,
        validate: (value) => value.length > 0 || "Required.",
      }),
    ).resolves.toEqual({ type: "submit", value: "a" });
    expect(screen.write).toHaveBeenCalledWith(expect.stringContaining("Required."));
  });
});

function createKeyInput(keys: Awaited<ReturnType<KeyInput["readKey"]>>[]): KeyInput {
  return {
    readKey: vi.fn(async () => {
      const key = keys.shift();

      if (key === undefined) {
        throw new Error("No key queued.");
      }

      return key;
    }),
    close: vi.fn(),
  };
}

function createScreen() {
  return {
    clear: vi.fn(),
    write: vi.fn(),
  };
}
