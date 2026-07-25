import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { AppConfig, WorkspaceConfig } from "../config/config-types.js";
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
    const addService = vi.fn(async () => undefined);
    const runPicker = vi
      .fn()
      .mockResolvedValueOnce({ type: "addService", workspace })
      .mockResolvedValueOnce({ type: "exit" });

    await runWorkspaceHome({
      store: createStore(config),
      keyInput,
      runPicker,
      addService,
      runSession: vi.fn(),
    });

    expect(addService).toHaveBeenCalledWith(workspace);
    expect(runPicker).toHaveBeenCalledTimes(2);
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
    async load() {
      return appConfig;
    },
    async save() {
      return undefined;
    },
  };
}

function createKeyInput() {
  return {
    readKey: vi.fn(async () => ({ sequence: "q" })),
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

const config: AppConfig = {
  version: 1,
  workspaces: [workspace],
};
