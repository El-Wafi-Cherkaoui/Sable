import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../config/config-types.js";
import type { KeyInput } from "../input/terminal-key-input.js";
import { runRenameWorkspaceFlow } from "./rename-workspace-flow.js";

describe("runRenameWorkspaceFlow", () => {
  it("renames a workspace through native prompts", async () => {
    const store = createStore(config);

    await expect(
      runRenameWorkspaceFlow({
        store,
        workspace,
        keyInput: createKeyInput([
          ...backspaces("ecommerce".length),
          ...text("shop"),
          { name: "return" },
        ]),
        screen: createScreen(),
      }),
    ).resolves.toEqual({
      type: "completed",
      workspaceId: "ws_ecommerce",
      message: 'Renamed workspace "ecommerce" to "shop".',
    });
    expect(store.savedConfig?.workspaces[0]?.name).toBe("shop");
  });

  it("rejects duplicate workspace names case-insensitively", async () => {
    const store = createStore(configWithTwoWorkspaces);
    const screen = createScreen();

    await runRenameWorkspaceFlow({
      store,
      workspace,
      keyInput: createKeyInput([
        ...backspaces("ecommerce".length),
        ...text("PORTFOLIO"),
        { name: "return" },
        ...backspaces("PORTFOLIO".length),
        ...text("shop"),
        { name: "return" },
      ]),
      screen,
    });

    expect(screen.output()).toContain('Workspace "PORTFOLIO" already exists.');
    expect(store.savedConfig?.workspaces.map((candidate) => candidate.name)).toEqual([
      "shop",
      "portfolio",
    ]);
  });

  it("allows an unchanged workspace name", async () => {
    const store = createStore(config);

    await expect(
      runRenameWorkspaceFlow({
        store,
        workspace,
        keyInput: createKeyInput([{ name: "return" }]),
        screen: createScreen(),
      }),
    ).resolves.toEqual({
      type: "completed",
      workspaceId: "ws_ecommerce",
      message: 'Renamed workspace "ecommerce" to "ecommerce".',
    });
  });

  it("goes back without saving on Esc", async () => {
    const store = createStore(config);

    await expect(
      runRenameWorkspaceFlow({
        store,
        workspace,
        keyInput: createKeyInput([{ name: "escape" }]),
        screen: createScreen(),
      }),
    ).resolves.toEqual({ type: "back", message: "Rename workspace cancelled." });
    expect(store.savedConfig).toBeUndefined();
  });

  it("exits without saving on Ctrl+C", async () => {
    const store = createStore(config);

    await expect(
      runRenameWorkspaceFlow({
        store,
        workspace,
        keyInput: createKeyInput([{ name: "c", ctrl: true }]),
        screen: createScreen(),
      }),
    ).resolves.toEqual({ type: "exit" });
    expect(store.savedConfig).toBeUndefined();
  });
});

function createStore(initialConfig: AppConfig) {
  return {
    savedConfig: undefined as AppConfig | undefined,
    async load() {
      return initialConfig;
    },
    async save(config: AppConfig) {
      this.savedConfig = config;
    },
  };
}

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
  const writes: string[] = [];

  return {
    clear: vi.fn(),
    write: vi.fn((contents: string) => writes.push(contents)),
    output: () => writes.join("\n"),
  };
}

function text(value: string): Array<{ sequence: string }> {
  return [...value].map((sequence) => ({ sequence }));
}

function backspaces(count: number): Array<{ name: "backspace" }> {
  return Array.from({ length: count }, () => ({ name: "backspace" as const }));
}

const workspace = {
  id: "ws_ecommerce",
  name: "ecommerce",
  projectDirectory: process.cwd(),
  services: [],
};

const portfolioWorkspace = {
  id: "ws_portfolio",
  name: "portfolio",
  projectDirectory: process.cwd(),
  services: [],
};

const config: AppConfig = {
  version: 1,
  workspaces: [workspace],
};

const configWithTwoWorkspaces: AppConfig = {
  version: 1,
  workspaces: [workspace, portfolioWorkspace],
};