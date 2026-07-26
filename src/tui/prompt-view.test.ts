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
