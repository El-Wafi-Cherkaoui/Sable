import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../config/config-types.js";
import type { KeyInput } from "../input/terminal-key-input.js";
import { runDeleteWorkspaceFlow } from "./delete-workspace-flow.js";

describe("runDeleteWorkspaceFlow", () => {
  it("deletes a workspace after exact typed-name confirmation", async () => {
    const store = createStore(config);

    const result = await runDeleteWorkspaceFlow({
      store,
      workspace: config.workspaces[0]!,
      keyInput: createKeyInput([...text("ecommerce"), { name: "return" }]),
      screen: createScreen(),
    });

    expect(result).toEqual({
      type: "completed",
      selectedWorkspaceId: "ws_api",
      message: 'Deleted workspace "ecommerce".',
    });
    expect(store.savedConfig?.workspaces.map((workspace) => workspace.id)).toEqual(["ws_api"]);
  });

  it("keeps prompting on mismatch", async () => {
    const store = createStore(config);
    const screen = createScreen();

    await runDeleteWorkspaceFlow({
      store,
      workspace: config.workspaces[0]!,
      keyInput: createKeyInput([
        ...text("wrong"),
        { name: "return" },
        ...backspaces("wrong".length),
        ...text("ecommerce"),
        { name: "return" },
      ]),
      screen,
    });

    expect(screen.output()).toContain("Name does not match. Try again or press Esc to cancel.");
    expect(store.savedConfig?.workspaces.map((workspace) => workspace.id)).toEqual(["ws_api"]);
  });

  it("selects the previous workspace when deleting the last workspace", async () => {
    const store = createStore(config);

    const result = await runDeleteWorkspaceFlow({
      store,
      workspace: config.workspaces[1]!,
      keyInput: createKeyInput([...text("api"), { name: "return" }]),
      screen: createScreen(),
    });

    expect(result).toEqual({
      type: "completed",
      selectedWorkspaceId: "ws_ecommerce",
      message: 'Deleted workspace "api".',
    });
  });

  it("has no selected workspace after deleting the only workspace", async () => {
    const onlyWorkspaceConfig: AppConfig = {
      version: 1,
      workspaces: [config.workspaces[0]!],
    };
    const store = createStore(onlyWorkspaceConfig);

    const result = await runDeleteWorkspaceFlow({
      store,
      workspace: onlyWorkspaceConfig.workspaces[0]!,
      keyInput: createKeyInput([...text("ecommerce"), { name: "return" }]),
      screen: createScreen(),
    });

    expect(result).toEqual({
      type: "completed",
      selectedWorkspaceId: undefined,
      message: 'Deleted workspace "ecommerce".',
    });
  });

  it("cancels without saving on Esc", async () => {
    const store = createStore(config);

    const result = await runDeleteWorkspaceFlow({
      store,
      workspace: config.workspaces[0]!,
      keyInput: createKeyInput([{ name: "escape" }]),
      screen: createScreen(),
    });

    expect(result).toEqual({ type: "back", message: "Delete workspace cancelled." });
    expect(store.savedConfig).toBeUndefined();
  });

  it("exits without saving on Ctrl+C", async () => {
    const store = createStore(config);

    const result = await runDeleteWorkspaceFlow({
      store,
      workspace: config.workspaces[0]!,
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

const config: AppConfig = {
  version: 1,
  workspaces: [
    {
      id: "ws_ecommerce",
      name: "ecommerce",
      projectDirectory: process.cwd(),
      services: [],
    },
    {
      id: "ws_api",
      name: "api",
      projectDirectory: process.cwd(),
      services: [],
    },
  ],
};
