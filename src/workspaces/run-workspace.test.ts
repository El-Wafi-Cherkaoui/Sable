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
    const runDashboard = vi.fn(async () => undefined);

    await runWorkspaceCommand(" Ecommerce ", {
      store: createStore(config),
      createController,
      keyInput,
      runDashboard,
    });

    expect(createController).toHaveBeenCalledWith(workspace);
    expect(controller.startAutoStartServices).toHaveBeenCalledBefore(runDashboard);
    expect(runDashboard).toHaveBeenCalledWith({ controller, keyInput });
    expect(keyInput.close).toHaveBeenCalledOnce();
    expect(controller.shutdown).toHaveBeenCalledOnce();
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
  };
}

function createFakeController(workspaceConfig: WorkspaceConfig) {
  return {
    startAutoStartServices: vi.fn(async () => undefined),
    getState: vi.fn(() => createRuntimeState(workspaceConfig)),
    selectNextService: vi.fn(() => createRuntimeState(workspaceConfig)),
    selectPreviousService: vi.fn(() => createRuntimeState(workspaceConfig)),
    shutdown: vi.fn(async () => undefined),
  };
}

function createKeyInput() {
  return {
    readKey: vi.fn(async () => ({ sequence: "q" })),
    close: vi.fn(),
  };
}

function createControllerForWorkspace(
  workspaceConfig: WorkspaceConfig,
): RunWorkspaceController {
  return createFakeController(workspaceConfig);
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
