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

    expect(screen.write).toHaveBeenCalledWith(expect.stringContaining("  a\n  ─"));
    expect(screen.write).not.toHaveBeenCalledWith(expect.stringContaining("> a"));
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

describe("runSelectPrompt", () => {
  it("moves selection and submits", async () => {
    await expect(
      runSelectPrompt({
        title: "Edit service",
        message: "Service",
        keyInput: createKeyInput([{ sequence: "j" }, { name: "return" }]),
        screen: createScreen(),
        choices: [
          { label: "api", value: "api" },
          { label: "web", value: "web" },
        ],
      }),
    ).resolves.toEqual({ type: "submit", value: "web" });
  });

  it("uses selected-row styling instead of > markers in color mode", async () => {
    const screen = createScreen();

    await runSelectPrompt({
      title: "Edit service",
      message: "Service",
      keyInput: createKeyInput([{ name: "return" }]),
      screen,
      color: true,
      choices: [
        { label: "api", value: "api" },
        { label: "web", value: "web" },
      ],
    });

    expect(screen.write).toHaveBeenCalledWith(expect.stringContaining("\x1b[48;5;236m  api\x1b[49m"));
    expect(screen.write).not.toHaveBeenCalledWith(expect.stringContaining("> api"));
  });

  it("pulses the newly selected choice in color mode", async () => {
    const screen = createScreen();

    await runSelectPrompt({
      title: "Edit service",
      message: "Service",
      keyInput: createKeyInput([{ sequence: "j" }, { name: "return" }]),
      screen,
      color: true,
      choices: [
        { label: "api", value: "api" },
        { label: "web", value: "web" },
      ],
    });

    expect(screen.write).toHaveBeenCalledWith(expect.stringContaining("\x1b[48;5;239m\x1b[1m  web\x1b[22m\x1b[49m"));
  });

  it("returns back on Esc", async () => {
    await expect(
      runSelectPrompt({
        title: "Edit service",
        message: "Service",
        keyInput: createKeyInput([{ name: "escape" }]),
        screen: createScreen(),
        choices: [{ label: "api", value: "api" }],
      }),
    ).resolves.toEqual({ type: "back" });
  });
});

describe("runConfirmPrompt", () => {
  it("submits yes and no shortcuts", async () => {
    await expect(
      runConfirmPrompt({
        title: "Edit service",
        message: "Remove?",
        keyInput: createKeyInput([{ sequence: "y" }]),
        screen: createScreen(),
      }),
    ).resolves.toEqual({ type: "submit", value: true });
    await expect(
      runConfirmPrompt({
        title: "Edit service",
        message: "Remove?",
        keyInput: createKeyInput([{ sequence: "n" }]),
        screen: createScreen(),
      }),
    ).resolves.toEqual({ type: "submit", value: false });
  });

  it("renders the default value with a subtle underline instead of a > marker", async () => {
    const screen = createScreen();

    await runConfirmPrompt({
      title: "Edit service",
      message: "Remove?",
      keyInput: createKeyInput([{ name: "return" }]),
      screen,
      defaultValue: true,
    });

    expect(screen.write).toHaveBeenCalledWith(expect.stringContaining("  yes\n  ───"));
    expect(screen.write).not.toHaveBeenCalledWith(expect.stringContaining("> yes"));
  });

  it("returns back on Esc", async () => {
    await expect(
      runConfirmPrompt({
        title: "Edit service",
        message: "Remove?",
        keyInput: createKeyInput([{ name: "escape" }]),
        screen: createScreen(),
      }),
    ).resolves.toEqual({ type: "back" });
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
