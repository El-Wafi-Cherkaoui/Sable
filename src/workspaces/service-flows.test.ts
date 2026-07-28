import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../config/config-types.js";
import type { KeyInput } from "../input/terminal-key-input.js";
import {
  runAddServiceFlow,
  runAddWorkspaceItemFlow,
  runAddCommandFlow,
  runDeleteServiceFlow,
  runEditServiceFlow,
  type ServiceFlowStore,
} from "./service-flows.js";

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

describe("runAddWorkspaceItemFlow", () => {
  it("asks whether to add a service or command before running the selected flow", async () => {
    const store = createStore(config);

    await expect(
      runAddWorkspaceItemFlow({
        store,
        workspace,
        keyInput: createKeyInput([
          { sequence: "j" },
          { name: "return" },
          ...text("build"),
          { name: "return" },
          ...text("npm run build"),
          { name: "return" },
          { name: "return" },
        ]),
        screen: createScreen(),
        generateId: vi.fn(() => "cmd_build"),
        directoryExists: () => true,
      }),
    ).resolves.toEqual({
      type: "completed",
      message: 'Added command "build" to workspace "ecommerce".',
      commandId: "cmd_build",
    });
    expect(store.savedConfig?.workspaces[0]?.commands[0]).toMatchObject({
      id: "cmd_build",
      name: "build",
      command: "npm run build",
      cwd: projectDirectory,
      env: {},
    });
  });

  it("goes back from the add-kind chooser without saving", async () => {
    const store = createStore(config);

    await expect(
      runAddWorkspaceItemFlow({
        store,
        workspace,
        keyInput: createKeyInput([{ name: "escape" }]),
        screen: createScreen(),
      }),
    ).resolves.toEqual({ type: "back", message: "Add cancelled." });
    expect(store.savedConfig).toBeUndefined();
  });
});

describe("runAddCommandFlow", () => {
  it("adds a command through native prompts", async () => {
    const store = createStore(config);

    await expect(
      runAddCommandFlow({
        store,
        workspace,
        keyInput: createKeyInput([
          ...text("test"),
          { name: "return" },
          ...text("npm test"),
          { name: "return" },
          { name: "return" },
        ]),
        screen: createScreen(),
        generateId: vi.fn(() => "cmd_test"),
        directoryExists: () => true,
      }),
    ).resolves.toEqual({
      type: "completed",
      message: 'Added command "test" to workspace "ecommerce".',
      commandId: "cmd_test",
    });
    expect(store.savedConfig?.workspaces[0]?.commands[0]?.command).toBe("npm test");
  });
});

describe("runEditServiceFlow", () => {
  it("renames a service through native prompts", async () => {
    const store = createStore(config);

    await expect(
      runEditServiceFlow({
        store,
        workspace,
        keyInput: createKeyInput([
          { name: "return" },
          { name: "return" },
          ...backspaces("api".length),
          { sequence: "b" },
          { sequence: "a" },
          { sequence: "c" },
          { sequence: "k" },
          { sequence: "e" },
          { sequence: "n" },
          { sequence: "d" },
          { name: "return" },
        ]),
        screen: createScreen(),
      }),
    ).resolves.toEqual({
      type: "completed",
      message: 'Renamed service "api" to "backend".',
      serviceId: "svc_api",
    });
    expect(store.savedConfig?.workspaces[0]?.services[0]?.name).toBe("backend");
  });

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
          { sequence: "j" },
          { name: "return" },
        ]),
        screen: createScreen(),
      }),
    ).resolves.toEqual({
      type: "completed",
      message: 'Auto-start disabled for "api".',
      serviceId: "svc_api",
    });
    expect(store.savedConfig?.workspaces[0]?.services[0]?.autoStart).toBe(false);
  });

  it("rejects duplicate service names case-insensitively while renaming", async () => {
    const store = createStore(configWithTwoServices);
    const screen = createScreen();

    await runEditServiceFlow({
      store,
      workspace: workspaceWithTwoServices,
      serviceId: "svc_api",
      keyInput: createKeyInput([
        { name: "return" },
        ...backspaces("api".length),
        { sequence: "W" },
        { sequence: "O" },
        { sequence: "R" },
        { sequence: "K" },
        { sequence: "E" },
        { sequence: "R" },
        { name: "return" },
        ...backspaces("WORKER".length),
        { sequence: "b" },
        { sequence: "a" },
        { sequence: "c" },
        { sequence: "k" },
        { sequence: "e" },
        { sequence: "n" },
        { sequence: "d" },
        { name: "return" },
      ]),
      screen,
    });

    expect(screen.output()).toContain('Service "WORKER" already exists in this workspace.');
    expect(store.savedConfig?.workspaces[0]?.services.map((service) => service.name)).toEqual([
      "backend",
      "worker",
    ]);
  });

  it("allows an unchanged service name while renaming", async () => {
    const store = createStore(config);

    await expect(
      runEditServiceFlow({
        store,
        workspace,
        serviceId: "svc_api",
        keyInput: createKeyInput([{ name: "return" }, { name: "return" }]),
        screen: createScreen(),
      }),
    ).resolves.toEqual({
      type: "completed",
      message: 'Renamed service "api" to "api".',
      serviceId: "svc_api",
    });
    expect(store.savedConfig?.workspaces[0]?.services[0]?.name).toBe("api");
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

describe("runDeleteServiceFlow", () => {
  it("deletes a service after typed-name confirmation", async () => {
    const store = createStore(config);

    await expect(
      runDeleteServiceFlow({
        store,
        workspace,
        serviceId: "svc_api",
        keyInput: createKeyInput([
          { sequence: "a" },
          { sequence: "p" },
          { sequence: "i" },
          { name: "return" },
        ]),
        screen: createScreen(),
      }),
    ).resolves.toEqual({
      type: "completed",
      message: 'Deleted service "api" from workspace "ecommerce".',
      removedServiceId: "svc_api",
    });
    expect(store.savedConfig?.workspaces[0]?.services).toEqual([]);
  });

  it("keeps prompting when the typed service name does not match", async () => {
    const store = createStore(config);

    await runDeleteServiceFlow({
      store,
      workspace,
      serviceId: "svc_api",
      keyInput: createKeyInput([
        { sequence: "x" },
        { name: "return" },
        { name: "backspace" },
        { sequence: "a" },
        { sequence: "p" },
        { sequence: "i" },
        { name: "return" },
      ]),
      screen: createScreen(),
    });

    expect(store.savedConfig?.workspaces[0]?.services).toEqual([]);
  });

  it("goes back without saving on Esc", async () => {
    const store = createStore(config);

    await expect(
      runDeleteServiceFlow({
        store,
        workspace,
        serviceId: "svc_api",
        keyInput: createKeyInput([{ name: "escape" }]),
        screen: createScreen(),
      }),
    ).resolves.toEqual({ type: "back", message: "Delete service cancelled." });
    expect(store.savedConfig).toBeUndefined();
  });

  it("exits without saving on Ctrl+C", async () => {
    const store = createStore(config);

    await expect(
      runDeleteServiceFlow({
        store,
        workspace,
        serviceId: "svc_api",
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
  const writes: string[] = [];

  return {
    clear: vi.fn(),
    write: vi.fn((contents: string) => writes.push(contents)),
    output: () => writes.join("\n"),
  };
}

function backspaces(count: number): Array<{ name: "backspace" }> {
  return Array.from({ length: count }, () => ({ name: "backspace" as const }));
}

function text(value: string): Array<{ sequence: string }> {
  return [...value].map((sequence) => ({ sequence }));
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
  commands: [],
};
const config: AppConfig = {
  version: 1,
  workspaces: [workspace],
};

const workspaceWithTwoServices = {
  ...workspace,
  services: [
    ...workspace.services,
    {
      id: "svc_worker",
      name: "worker",
      command: "npm run worker",
      cwd: projectDirectory,
      autoStart: false,
      env: {},
    },
  ],
};

const configWithTwoServices: AppConfig = {
  version: 1,
  workspaces: [workspaceWithTwoServices],
};
