import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { AppConfig, WorkspaceConfig } from "../config/config-types.js";
import type { KeyInput } from "../input/terminal-key-input.js";
import { runWorkspaceHome } from "./workspace-home.js";

describe("runWorkspaceHome", () => {
  it("opens the picker, runs the selected workspace, returns to picker, then exits", async () => {
    const keyInput = createKeyInput();
    const runPicker = vi
      .fn()
      .mockResolvedValueOnce({ type: "run", workspace })
      .mockResolvedValueOnce({ type: "exit" });
    const runSession = vi.fn(async () => ({ type: "back" as const }));

    await runWorkspaceHome({
      store: createStore(config),
      keyInput,
      runPicker,
      runSession,
    });

    expect(runPicker).toHaveBeenCalledTimes(2);
    expect(runPicker).toHaveBeenNthCalledWith(1, {
      workspaces: config.workspaces,
      keyInput,
      abortSignal: expect.any(AbortSignal),
      statusMessage: undefined,
      screen: undefined,
    });
    expect(runSession).toHaveBeenCalledWith({
      workspace,
      createController: undefined,
      keyInput,
      abortSignal: expect.any(AbortSignal),
      dashboardQuitLabel: "back",
    });
    expect(keyInput.close).toHaveBeenCalledOnce();
  });

  it("exits the app when the workspace session exits", async () => {
    const runPicker = vi.fn(async () => ({ type: "run" as const, workspace }));
    const runSession = vi.fn(async () => ({ type: "exit" as const }));

    await runWorkspaceHome({
      store: createStore(config),
      keyInput: createKeyInput(),
      runPicker,
      runSession,
    });

    expect(runPicker).toHaveBeenCalledOnce();
  });

  it("adds a service from the picker and reloads workspaces", async () => {
    const keyInput = createKeyInput();
    const runAddService = vi.fn(async () => ({
      type: "completed" as const,
      message: "Added service.",
    }));
    const runPicker = vi
      .fn()
      .mockResolvedValueOnce({ type: "addService", workspace })
      .mockResolvedValueOnce({ type: "exit" });

    await runWorkspaceHome({
      store: createStore(config),
      keyInput,
      runPicker,
      runAddService,
      runSession: vi.fn(),
    });

    expect(runAddService).toHaveBeenCalledWith(expect.objectContaining({ workspace }));
    expect(runPicker).toHaveBeenCalledTimes(2);
    expect(runPicker).toHaveBeenNthCalledWith(2, expect.objectContaining({
      statusMessage: "Added service.",
    }));
    expect(keyInput.close).toHaveBeenCalledOnce();
  });

  it("edits a service from the picker and reloads workspaces", async () => {
    const keyInput = createKeyInput();
    const runEditService = vi.fn(async () => ({
      type: "completed" as const,
      message: "Auto-start disabled for api.",
    }));
    const runPicker = vi
      .fn()
      .mockResolvedValueOnce({ type: "editService", workspace })
      .mockResolvedValueOnce({ type: "exit" });

    await runWorkspaceHome({
      store: createStore(config),
      keyInput,
      runPicker,
      runEditService,
      runSession: vi.fn(),
    });

    expect(runEditService).toHaveBeenCalledWith(expect.objectContaining({ workspace }));
    expect(runPicker).toHaveBeenCalledTimes(2);
    expect(runPicker).toHaveBeenNthCalledWith(2, expect.objectContaining({
      statusMessage: "Auto-start disabled for api.",
    }));
    expect(keyInput.close).toHaveBeenCalledOnce();
  });

  it("returns to the picker with a message when add service goes back", async () => {
    const keyInput = createKeyInput();
    const runAddService = vi.fn(async () => ({
      type: "back" as const,
      message: "Add service cancelled.",
    }));
    const runPicker = vi
      .fn()
      .mockResolvedValueOnce({ type: "addService", workspace })
      .mockResolvedValueOnce({ type: "exit" });

    await runWorkspaceHome({
      store: createStore(config),
      keyInput,
      runPicker,
      runAddService,
      runSession: vi.fn(),
    });

    expect(runPicker).toHaveBeenNthCalledWith(2, expect.objectContaining({
      statusMessage: "Add service cancelled.",
    }));
  });

  it("returns to the picker with a message when edit service goes back", async () => {
    const keyInput = createKeyInput();
    const runEditService = vi.fn(async () => ({
      type: "back" as const,
      message: "Edit cancelled.",
    }));
    const runPicker = vi
      .fn()
      .mockResolvedValueOnce({ type: "editService", workspace })
      .mockResolvedValueOnce({ type: "exit" });

    await runWorkspaceHome({
      store: createStore(config),
      keyInput,
      runPicker,
      runEditService,
      runSession: vi.fn(),
    });

    expect(runPicker).toHaveBeenNthCalledWith(2, expect.objectContaining({
      statusMessage: "Edit cancelled.",
    }));
  });

  it("exits the app when edit service flow exits", async () => {
    const keyInput = createKeyInput();
    const runEditService = vi.fn(async () => ({ type: "exit" as const }));
    const runPicker = vi.fn(async () => ({ type: "editService" as const, workspace }));

    await runWorkspaceHome({
      store: createStore(config),
      keyInput,
      runPicker,
      runEditService,
      runSession: vi.fn(),
    });

    expect(runPicker).toHaveBeenCalledOnce();
    expect(keyInput.close).toHaveBeenCalledOnce();
  });

  it("can enter edit, Esc back, enter edit again, and Esc back again", async () => {
    const keyInput = createQueuedKeyInput([
      { sequence: "e" },
      { name: "escape" },
      { sequence: "e" },
      { name: "escape" },
      { sequence: "q" },
    ]);
    const store = createStore(configWithService);
    const screen = { clear: vi.fn(), write: vi.fn() };

    await runWorkspaceHome({
      store,
      keyInput,
      runSession: vi.fn(),
      runPicker: undefined,
      runEditService: undefined,
      screen,
    });

    expect(store.savedConfig).toBeUndefined();
    expect(screen.write.mock.calls.map(([contents]) => contents).join("\n")).not.toContain("^[");
    expect(keyInput.close).toHaveBeenCalledOnce();
  });

  it("aborts picker wait on SIGINT and removes signal listeners", async () => {
    const signalSource = createSignalSource();
    const runPicker = vi.fn(
      async ({ abortSignal }: { abortSignal?: AbortSignal }) =>
        new Promise<{ type: "exit" }>((resolve) => {
          abortSignal?.addEventListener(
            "abort",
            () => resolve({ type: "exit" }),
            { once: true },
          );
        }),
    );
    const keyInput = createKeyInput();

    const runPromise = runWorkspaceHome({
      store: createStore(config),
      keyInput,
      runPicker,
      runSession: vi.fn(),
      signalSource,
    });

    await waitUntil(() => runPicker.mock.calls.length === 1);
    signalSource.emit("SIGINT");
    await runPromise;

    expect(keyInput.close).toHaveBeenCalledOnce();
    expect(signalSource.listenerCount("SIGINT")).toBe(0);
    expect(signalSource.listenerCount("SIGTERM")).toBe(0);
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

function createKeyInput() {
  return {
    readKey: vi.fn(async () => ({ sequence: "q" })),
    close: vi.fn(),
  };
}

function createQueuedKeyInput(keys: Array<Awaited<ReturnType<KeyInput["readKey"]>>>): KeyInput {
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

function createSignalSource() {
  const emitter = new EventEmitter();

  return {
    once(signal: NodeJS.Signals, listener: () => void) {
      emitter.once(signal, listener);
    },
    off(signal: NodeJS.Signals, listener: () => void) {
      emitter.off(signal, listener);
    },
    emit(signal: NodeJS.Signals) {
      emitter.emit(signal);
    },
    listenerCount(signal: NodeJS.Signals) {
      return emitter.listenerCount(signal);
    },
  };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;

  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  expect(predicate()).toBe(true);
}

const workspace: WorkspaceConfig = {
  id: "ws_ecommerce",
  name: "ecommerce",
  services: [],
};

const workspaceWithService: WorkspaceConfig = {
  id: "ws_ecommerce",
  name: "ecommerce",
  services: [
    {
      id: "svc_api",
      name: "api",
      command: "npm run dev",
      cwd: process.cwd(),
      autoStart: true,
      env: {},
    },
  ],
};

const config: AppConfig = {
  version: 1,
  workspaces: [workspace],
};

const configWithService: AppConfig = {
  version: 1,
  workspaces: [workspaceWithService],
};
