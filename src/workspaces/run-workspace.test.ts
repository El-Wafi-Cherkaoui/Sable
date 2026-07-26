import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { AppConfig, WorkspaceConfig } from "../config/config-types.js";
import { createRuntimeState } from "../runtime/runtime-state.js";
import { WorkspaceLookupError } from "./find-workspace.js";
import { runWorkspaceCommand, type RunWorkspaceController } from "./run-workspace.js";

describe("runWorkspaceCommand", () => {
  it("loads a workspace, starts auto-start services, opens dashboard, and shuts down", async () => {
    const controller = createFakeController(workspace);
    const createController = vi.fn(() => controller);
    const keyInput = createKeyInput();
    const runDashboard = vi.fn(async () => ({ type: "back" as const }));

    await runWorkspaceCommand(" Ecommerce ", {
      store: createStore(config),
      createController,
      keyInput,
      runDashboard,
    });

    expect(createController).toHaveBeenCalledWith(workspace);
    expect(controller.startAutoStartServices).toHaveBeenCalledBefore(runDashboard);
    expect(runDashboard).toHaveBeenCalledWith({
      controller,
      keyInput,
      abortSignal: expect.any(AbortSignal),
      dashboardQuitLabel: undefined,
      onAddService: expect.any(Function),
    });
    expect(keyInput.close).toHaveBeenCalledOnce();
    expect(controller.shutdown).toHaveBeenCalledOnce();
  });

  it("aborts the dashboard on SIGINT and still cleans up", async () => {
    const controller = createFakeController(workspace);
    const keyInput = createKeyInput();
    const signalSource = createSignalSource();
    const runDashboard = vi.fn(
      async ({ abortSignal }: { abortSignal?: AbortSignal }) =>
        new Promise<{ type: "exit" }>((resolve) => {
          abortSignal?.addEventListener(
            "abort",
            () => resolve({ type: "exit" }),
            { once: true },
          );
        }),
    );

    const runPromise = runWorkspaceCommand("ecommerce", {
      store: createStore(config),
      createController: () => controller,
      keyInput,
      runDashboard,
      signalSource,
    });

    await waitUntil(() => runDashboard.mock.calls.length === 1);
    signalSource.emit("SIGINT");
    await runPromise;

    expect(keyInput.close).toHaveBeenCalledOnce();
    expect(controller.shutdown).toHaveBeenCalledOnce();
    expect(signalSource.listenerCount("SIGINT")).toBe(0);
    expect(signalSource.listenerCount("SIGTERM")).toBe(0);
  });

  it("closes input and shuts down even when dashboard fails", async () => {
    const controller = createFakeController(workspace);
    const keyInput = createKeyInput();

    await expect(
      runWorkspaceCommand("ecommerce", {
        store: createStore(config),
        createController: () => controller,
        keyInput,
        runDashboard: async () => {
          throw new Error("dashboard failed");
        },
      }),
    ).rejects.toThrow("dashboard failed");
    expect(keyInput.close).toHaveBeenCalledOnce();
    expect(controller.shutdown).toHaveBeenCalledOnce();
  });

  it("throws for unknown workspaces before creating a controller", async () => {
    const createController = vi.fn(() => createControllerForWorkspace(workspace));

    await expect(
      runWorkspaceCommand("missing", {
        store: createStore(config),
        createController,
        keyInput: createKeyInput(),
      }),
    ).rejects.toBeInstanceOf(WorkspaceLookupError);
    expect(createController).not.toHaveBeenCalled();
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

function createFakeController(workspaceConfig: WorkspaceConfig) {
  return {
    startAutoStartServices: vi.fn(async () => undefined),
    getState: vi.fn(() => createRuntimeState(workspaceConfig)),
    selectNextService: vi.fn(() => createRuntimeState(workspaceConfig)),
    selectPreviousService: vi.fn(() => createRuntimeState(workspaceConfig)),
    startSelectedService: vi.fn(async () => ({ status: "running" as const })),
    stopSelectedService: vi.fn(async () => ({ status: "stopped" as const })),
    restartSelectedService: vi.fn(async () => ({ status: "running" as const })),
    startService: vi.fn(async () => ({ status: "running" as const })),
    addService: vi.fn(() => createRuntimeState(workspaceConfig)),
    getSelectedServiceLogs: vi.fn(() => []),
    shutdown: vi.fn(async () => undefined),
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

function createControllerForWorkspace(
  workspaceConfig: WorkspaceConfig,
): RunWorkspaceController {
  return createFakeController(workspaceConfig);
}

const workspace: WorkspaceConfig = {
  id: "ws_ecommerce",
  name: "ecommerce",
  projectDirectory: process.cwd(),
  services: [],
};

const config: AppConfig = {
  version: 1,
  workspaces: [workspace],
};
