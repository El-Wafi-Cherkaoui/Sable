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
      selectedWorkspaceId: undefined,
      screen: undefined,
    });
    expect(runSession).toHaveBeenCalledWith({
      workspace,
      createController: undefined,
      keyInput,
      abortSignal: expect.any(AbortSignal),
      dashboardQuitLabel: "back",
      store: expect.any(Object),
    });
    expect(keyInput.close).toHaveBeenCalledOnce();
  });

  it("clears picker status after returning from a workspace session", async () => {
    const keyInput = createKeyInput();
    const runPicker = vi
      .fn()
      .mockResolvedValueOnce({ type: "createWorkspace" })
      .mockResolvedValueOnce({ type: "run", workspace })
      .mockResolvedValueOnce({ type: "exit" });
    const runCreateWorkspace = vi.fn(async () => ({
      type: "completed" as const,
      workspaceId: workspace.id,
      message: "Created workspace.",
    }));
    const runSession = vi.fn(async () => ({ type: "back" as const }));

    await runWorkspaceHome({
      store: createStore(config),
      keyInput,
      runPicker,
      runCreateWorkspace,
      runSession,
    });

    expect(runPicker).toHaveBeenNthCalledWith(2, expect.objectContaining({
      statusMessage: "Created workspace.",
      selectedWorkspaceId: workspace.id,
    }));
    expect(runPicker).toHaveBeenNthCalledWith(3, expect.objectContaining({
      statusMessage: undefined,
      selectedWorkspaceId: workspace.id,
    }));
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

  it("creates a workspace from the picker and reloads workspaces with the new selection", async () => {
    const keyInput = createKeyInput();
    const runCreateWorkspace = vi.fn(async () => ({
      type: "completed" as const,
      workspaceId: "ws_new",
      message: "Created workspace.",
    }));
    const runPicker = vi
      .fn()
      .mockResolvedValueOnce({ type: "createWorkspace" })
      .mockResolvedValueOnce({ type: "exit" });

    await runWorkspaceHome({
      store: createStore(config),
      keyInput,
      runPicker,
      runCreateWorkspace,
      runSession: vi.fn(),
    });

    expect(runCreateWorkspace).toHaveBeenCalledWith(expect.objectContaining({
      store: expect.any(Object),
      keyInput,
      screen: undefined,
    }));
    expect(runPicker).toHaveBeenCalledTimes(2);
    expect(runPicker).toHaveBeenNthCalledWith(2, expect.objectContaining({
      statusMessage: "Created workspace.",
      selectedWorkspaceId: "ws_new",
    }));
    expect(keyInput.close).toHaveBeenCalledOnce();
  });

  it("returns to the picker with a message when create workspace goes back", async () => {
    const keyInput = createKeyInput();
    const runCreateWorkspace = vi.fn(async () => ({
      type: "back" as const,
      message: "Create workspace cancelled.",
    }));
    const runPicker = vi
      .fn()
      .mockResolvedValueOnce({ type: "createWorkspace" })
      .mockResolvedValueOnce({ type: "exit" });

    await runWorkspaceHome({
      store: createStore(config),
      keyInput,
      runPicker,
      runCreateWorkspace,
      runSession: vi.fn(),
    });

    expect(runPicker).toHaveBeenNthCalledWith(2, expect.objectContaining({
      statusMessage: "Create workspace cancelled.",
      selectedWorkspaceId: undefined,
    }));
  });

  it("exits the app when create workspace flow exits", async () => {
    const keyInput = createKeyInput();
    const runCreateWorkspace = vi.fn(async () => ({ type: "exit" as const }));
    const runPicker = vi.fn(async () => ({ type: "createWorkspace" as const }));

    await runWorkspaceHome({
      store: createStore(config),
      keyInput,
      runPicker,
      runCreateWorkspace,
      runSession: vi.fn(),
    });

    expect(runPicker).toHaveBeenCalledOnce();
    expect(keyInput.close).toHaveBeenCalledOnce();
  });

  it("deletes a workspace from the picker and reloads workspaces with the next selection", async () => {
    const keyInput = createKeyInput();
    const runDeleteWorkspace = vi.fn(async () => ({
      type: "completed" as const,
      selectedWorkspaceId: "ws_next",
      message: "Deleted workspace.",
    }));
    const runPicker = vi
      .fn()
      .mockResolvedValueOnce({ type: "deleteWorkspace", workspace })
      .mockResolvedValueOnce({ type: "exit" });

    await runWorkspaceHome({
      store: createStore(config),
      keyInput,
      runPicker,
      runDeleteWorkspace,
      runSession: vi.fn(),
    });

    expect(runDeleteWorkspace).toHaveBeenCalledWith(expect.objectContaining({
      store: expect.any(Object),
      workspace,
      keyInput,
      screen: undefined,
    }));
    expect(runPicker).toHaveBeenNthCalledWith(2, expect.objectContaining({
      statusMessage: "Deleted workspace.",
      selectedWorkspaceId: "ws_next",
    }));
  });

  it("returns to the picker with a message when delete workspace goes back", async () => {
    const keyInput = createKeyInput();
    const runDeleteWorkspace = vi.fn(async () => ({
      type: "back" as const,
      message: "Delete workspace cancelled.",
    }));
    const runPicker = vi
      .fn()
      .mockResolvedValueOnce({ type: "deleteWorkspace", workspace })
      .mockResolvedValueOnce({ type: "exit" });

    await runWorkspaceHome({
      store: createStore(config),
      keyInput,
      runPicker,
      runDeleteWorkspace,
      runSession: vi.fn(),
    });

    expect(runPicker).toHaveBeenNthCalledWith(2, expect.objectContaining({
      statusMessage: "Delete workspace cancelled.",
      selectedWorkspaceId: undefined,
    }));
  });

  it("renames a workspace from the picker and reloads workspaces with the same selection", async () => {
    const keyInput = createKeyInput();
    const runRenameWorkspace = vi.fn(async () => ({
      type: "completed" as const,
      workspaceId: "ws_ecommerce",
      message: "Renamed workspace.",
    }));
    const runPicker = vi
      .fn()
      .mockResolvedValueOnce({ type: "renameWorkspace", workspace })
      .mockResolvedValueOnce({ type: "exit" });

    await runWorkspaceHome({
      store: createStore(config),
      keyInput,
      runPicker,
      runRenameWorkspace,
      runSession: vi.fn(),
    });

    expect(runRenameWorkspace).toHaveBeenCalledWith(expect.objectContaining({
      store: expect.any(Object),
      workspace,
      keyInput,
      screen: undefined,
    }));
    expect(runPicker).toHaveBeenNthCalledWith(2, expect.objectContaining({
      statusMessage: "Renamed workspace.",
      selectedWorkspaceId: "ws_ecommerce",
    }));
  });

  it("returns to the picker with a message when rename workspace goes back", async () => {
    const keyInput = createKeyInput();
    const runRenameWorkspace = vi.fn(async () => ({
      type: "back" as const,
      message: "Rename workspace cancelled.",
    }));
    const runPicker = vi
      .fn()
      .mockResolvedValueOnce({ type: "renameWorkspace", workspace })
      .mockResolvedValueOnce({ type: "exit" });

    await runWorkspaceHome({
      store: createStore(config),
      keyInput,
      runPicker,
      runRenameWorkspace,
      runSession: vi.fn(),
    });

    expect(runPicker).toHaveBeenNthCalledWith(2, expect.objectContaining({
      statusMessage: "Rename workspace cancelled.",
      selectedWorkspaceId: "ws_ecommerce",
    }));
  });

  it("exits the app when rename workspace flow exits", async () => {
    const keyInput = createKeyInput();
    const runRenameWorkspace = vi.fn(async () => ({ type: "exit" as const }));
    const runPicker = vi.fn(async () => ({ type: "renameWorkspace" as const, workspace }));

    await runWorkspaceHome({
      store: createStore(config),
      keyInput,
      runPicker,
      runRenameWorkspace,
      runSession: vi.fn(),
    });

    expect(runPicker).toHaveBeenCalledOnce();
    expect(keyInput.close).toHaveBeenCalledOnce();
  });

  it("moves a workspace up from the picker", async () => {
    const store = createStore(configWithTwoWorkspaces);
    const runPicker = vi
      .fn()
      .mockResolvedValueOnce({ type: "moveWorkspaceUp", workspace: portfolioWorkspace })
      .mockResolvedValueOnce({ type: "exit" });

    await runWorkspaceHome({
      store,
      keyInput: createKeyInput(),
      runPicker,
      runSession: vi.fn(),
    });

    expect(store.savedConfig?.workspaces.map((candidate) => candidate.id)).toEqual([
      "ws_portfolio",
      "ws_ecommerce",
    ]);
    expect(runPicker).toHaveBeenNthCalledWith(2, expect.objectContaining({
      statusMessage: 'Moved workspace "portfolio" up.',
      selectedWorkspaceId: "ws_portfolio",
    }));
  });

  it("moves a workspace down from the picker", async () => {
    const store = createStore(configWithTwoWorkspaces);
    const runPicker = vi
      .fn()
      .mockResolvedValueOnce({ type: "moveWorkspaceDown", workspace })
      .mockResolvedValueOnce({ type: "exit" });

    await runWorkspaceHome({
      store,
      keyInput: createKeyInput(),
      runPicker,
      runSession: vi.fn(),
    });

    expect(store.savedConfig?.workspaces.map((candidate) => candidate.id)).toEqual([
      "ws_portfolio",
      "ws_ecommerce",
    ]);
    expect(runPicker).toHaveBeenNthCalledWith(2, expect.objectContaining({
      statusMessage: 'Moved workspace "ecommerce" down.',
      selectedWorkspaceId: "ws_ecommerce",
    }));
  });

  it("does not move a workspace beyond the list boundary", async () => {
    const store = createStore(configWithTwoWorkspaces);
    const runPicker = vi
      .fn()
      .mockResolvedValueOnce({ type: "moveWorkspaceUp", workspace })
      .mockResolvedValueOnce({ type: "exit" });

    await runWorkspaceHome({
      store,
      keyInput: createKeyInput(),
      runPicker,
      runSession: vi.fn(),
    });

    expect(store.savedConfig).toBeUndefined();
    expect(runPicker).toHaveBeenNthCalledWith(2, expect.objectContaining({
      statusMessage: 'Workspace "ecommerce" is already first.',
      selectedWorkspaceId: "ws_ecommerce",
    }));
  });

  it("exits the app when delete workspace flow exits", async () => {
    const keyInput = createKeyInput();
    const runDeleteWorkspace = vi.fn(async () => ({ type: "exit" as const }));
    const runPicker = vi.fn(async () => ({ type: "deleteWorkspace" as const, workspace }));

    await runWorkspaceHome({
      store: createStore(config),
      keyInput,
      runPicker,
      runDeleteWorkspace,
      runSession: vi.fn(),
    });

    expect(runPicker).toHaveBeenCalledOnce();
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
  projectDirectory: process.cwd(),
  services: [],
};

const workspaceWithService: WorkspaceConfig = {
  id: "ws_ecommerce",
  name: "ecommerce",
  projectDirectory: process.cwd(),
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

const portfolioWorkspace: WorkspaceConfig = {
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

const configWithService: AppConfig = {
  version: 1,
  workspaces: [workspaceWithService],
};
