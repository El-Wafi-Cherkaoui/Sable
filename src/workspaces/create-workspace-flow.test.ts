import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../config/config-types.js";
import type { KeyInput } from "../input/terminal-key-input.js";
import { runCreateWorkspaceFlow } from "./create-workspace-flow.js";

describe("runCreateWorkspaceFlow", () => {
  it("creates a blank workspace with a project directory", async () => {
    const store = createStore(emptyConfig);
    const projectDirectory = path.resolve("C:\\projects\\shop");

    const result = await runCreateWorkspaceFlow({
      store,
      keyInput: createKeyInput([
        ...text("shop"),
        { name: "return" },
        ...text(projectDirectory),
        { name: "return" },
      ]),
      screen: createScreen(),
      generateId: () => "ws_shop",
      defaultProjectDirectory: "",
      projectDirectoryExists: (directoryPath) => directoryPath === projectDirectory,
    });

    expect(result).toEqual({
      type: "completed",
      workspaceId: "ws_shop",
      message: 'Created workspace "shop".',
    });
    expect(store.savedConfig?.workspaces).toEqual([
      {
        id: "ws_shop",
        name: "shop",
        projectDirectory,
        services: [],
      },
    ]);
  });

  it("keeps prompting when the workspace name is invalid", async () => {
    const store = createStore(emptyConfig);

    await runCreateWorkspaceFlow({
      store,
      keyInput: createKeyInput([
        { name: "return" },
        ...text("bad name"),
        { name: "return" },
        ...backspaces("bad name".length),
        ...text("good_name"),
        { name: "return" },
        { name: "return" },
      ]),
      screen: createScreen(),
      generateId: () => "ws_good",
      defaultProjectDirectory: process.cwd(),
      projectDirectoryExists: () => true,
    });

    expect(store.savedConfig?.workspaces[0]?.name).toBe("good_name");
  });

  it("rejects duplicate workspace names case-insensitively", async () => {
    const store = createStore({
      version: 1,
      workspaces: [
        {
          id: "ws_shop",
          name: "shop",
          projectDirectory: process.cwd(),
          services: [],
        },
      ],
    });
    const screen = createScreen();

    await runCreateWorkspaceFlow({
      store,
      keyInput: createKeyInput([
        ...text("SHOP"),
        { name: "return" },
        ...backspaces("SHOP".length),
        ...text("portfolio"),
        { name: "return" },
        { name: "return" },
      ]),
      screen,
      generateId: () => "ws_portfolio",
      defaultProjectDirectory: process.cwd(),
      projectDirectoryExists: () => true,
    });

    expect(screen.output()).toContain('Workspace "SHOP" already exists.');
    expect(store.savedConfig?.workspaces.map((workspace) => workspace.name)).toEqual([
      "shop",
      "portfolio",
    ]);
  });

  it("keeps prompting when the project directory is invalid", async () => {
    const store = createStore(emptyConfig);
    const validDirectory = path.resolve("C:\\projects\\valid");

    await runCreateWorkspaceFlow({
      store,
      keyInput: createKeyInput([
        ...text("shop"),
        { name: "return" },
        ...text("C:\\projects\\missing"),
        { name: "return" },
        ...backspaces("C:\\projects\\missing".length),
        ...text(validDirectory),
        { name: "return" },
      ]),
      screen: createScreen(),
      generateId: () => "ws_shop",
      defaultProjectDirectory: "",
      projectDirectoryExists: (directoryPath) => directoryPath === validDirectory,
    });

    expect(store.savedConfig?.workspaces[0]?.projectDirectory).toBe(validDirectory);
  });

  it("cancels without saving on Esc", async () => {
    const store = createStore(emptyConfig);

    const result = await runCreateWorkspaceFlow({
      store,
      keyInput: createKeyInput([{ name: "escape" }]),
      screen: createScreen(),
    });

    expect(result).toEqual({ type: "back", message: "Create workspace cancelled." });
    expect(store.savedConfig).toBeUndefined();
  });

  it("exits on Ctrl+C", async () => {
    const store = createStore(emptyConfig);

    const result = await runCreateWorkspaceFlow({
      store,
      keyInput: createKeyInput([{ name: "c", ctrl: true }]),
      screen: createScreen(),
    });

    expect(result).toEqual({ type: "exit" });
    expect(store.savedConfig).toBeUndefined();
  });
});

function createStore(appConfig: AppConfig) {
  return {
    savedConfig: undefined as AppConfig | undefined,
    async load() {
      return appConfig;
    },
    async save(config: AppConfig) {
      this.savedConfig = config;
    },
  };
}

function createKeyInput(keys: Array<Awaited<ReturnType<KeyInput["readKey"]>>>): KeyInput {
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

const emptyConfig: AppConfig = {
  version: 1,
  workspaces: [],
};
