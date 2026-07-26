import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../config/config-types.js";
import type { KeyInput } from "../input/terminal-key-input.js";
import { runAddServiceFlow, runEditServiceFlow, type ServiceFlowStore } from "./service-flows.js";

describe("runAddServiceFlow", () => {
  it("adds a service through native prompts", async () => {
    const store = createStore(config);

    await expect(
      runAddServiceFlow({
        store,
        workspace,
        keyInput: createKeyInput([
          { sequence: "w" },
          { name: "return" },
          { sequence: "n" },
          { sequence: "p" },
          { sequence: "m" },
          { name: "return" },
          { name: "return" },
          { sequence: "n" },
        ]),
        screen: createScreen(),
        generateId: vi.fn(() => "svc_worker"),
        directoryExists: () => true,
      }),
    ).resolves.toEqual({
      type: "completed",
      message: 'Added service "w" to workspace "ecommerce".',
      serviceId: "svc_worker",
    });
    expect(store.savedConfig?.workspaces[0]?.services[1]).toMatchObject({
      id: "svc_worker",
      name: "w",
      command: "npm",
      cwd: projectDirectory,
      autoStart: false,
    });
  });

  it("goes back without saving on Esc", async () => {
    const store = createStore(config);

    await expect(
      runAddServiceFlow({
        store,
        workspace,
        keyInput: createKeyInput([{ name: "escape" }]),
        screen: createScreen(),
      }),
    ).resolves.toEqual({ type: "back", message: "Add service cancelled." });
    expect(store.savedConfig).toBeUndefined();
  });

  it("exits without saving on Ctrl+C", async () => {
    const store = createStore(config);

    await expect(
      runAddServiceFlow({
        store,
        workspace,
        keyInput: createKeyInput([{ name: "c", ctrl: true }]),
        screen: createScreen(),
      }),
    ).resolves.toEqual({ type: "exit" });
    expect(store.savedConfig).toBeUndefined();
  });
});

describe("runEditServiceFlow", () => {
  it("toggles autoStart through native prompts", async () => {
    const store = createStore(config);

    await expect(
      runEditServiceFlow({
        store,
        workspace,
        keyInput: createKeyInput([
          { name: "return" },
          { sequence: "j" },
          { sequence: "j" },
          { name: "return" },
        ]),
        screen: createScreen(),
      }),
    ).resolves.toEqual({
      type: "completed",
      message: 'Auto-start disabled for "api".',
    });
    expect(store.savedConfig?.workspaces[0]?.services[0]?.autoStart).toBe(false);
  });

  it("goes back from service selection repeatedly without saving", async () => {
    const store = createStore(config);

    await expect(
      runEditServiceFlow({
        store,
        workspace,
        keyInput: createKeyInput([{ name: "escape" }]),
        screen: createScreen(),
      }),
    ).resolves.toEqual({ type: "back", message: "Edit cancelled." });
    expect(store.savedConfig).toBeUndefined();
  });

  it("exits without saving on Ctrl+C", async () => {
    const store = createStore(config);

    await expect(
      runEditServiceFlow({
        store,
        workspace,
        keyInput: createKeyInput([{ name: "c", ctrl: true }]),
        screen: createScreen(),
      }),
    ).resolves.toEqual({ type: "exit" });
    expect(store.savedConfig).toBeUndefined();
  });
});

function createStore(initialConfig: AppConfig): ServiceFlowStore & {
  savedConfig?: AppConfig;
} {
  return {
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
  return {
    clear: vi.fn(),
    write: vi.fn(),
  };
}

const projectDirectory = path.resolve("C:\\projects\\shop");
const workspace = {
  id: "ws_ecommerce",
  name: "ecommerce",
  projectDirectory,
  services: [
    {
      id: "svc_api",
      name: "api",
      command: "npm run dev",
      cwd: projectDirectory,
      autoStart: true,
      env: {},
    },
  ],
};
const config: AppConfig = {
  version: 1,
  workspaces: [workspace],
};
