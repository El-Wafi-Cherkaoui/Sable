import { describe, expect, it, vi } from "vitest";
import type { AppConfig, WorkspaceConfig } from "../config/config-types.js";
import type { RuntimeWorkspaceState } from "../runtime/runtime-state.js";
import { createRuntimeState } from "../runtime/runtime-state.js";
import { WorkspaceLookupError } from "./find-workspace.js";
import { runWorkspaceCommand, type RunWorkspaceController } from "./run-workspace.js";

describe("runWorkspaceCommand", () => {
  it("loads a workspace, starts auto-start services, renders once, and shuts down", async () => {
    const log = vi.fn();
    const controller = createFakeController(workspace);
    const createController = vi.fn(() => controller);
    const render = vi.fn(() => "dashboard");

    await runWorkspaceCommand(" Ecommerce ", {
      store: createStore(config),
      output: { log },
      createController,
      render,
    });

    expect(createController).toHaveBeenCalledWith(workspace);
    expect(controller.startAutoStartServices).toHaveBeenCalledBefore(render);
    expect(render).toHaveBeenCalledWith(controller.getState());
    expect(log).toHaveBeenCalledWith("dashboard");
    expect(controller.shutdown).toHaveBeenCalledOnce();
  });

  it("shuts down even when rendering fails", async () => {
    const controller = createFakeController(workspace);

    await expect(
      runWorkspaceCommand("ecommerce", {
        store: createStore(config),
        output: { log: vi.fn() },
        createController: () => controller,
        render: () => {
          throw new Error("render failed");
        },
      }),
    ).rejects.toThrow("render failed");
    expect(controller.shutdown).toHaveBeenCalledOnce();
  });

  it("throws for unknown workspaces before creating a controller", async () => {
    const createController = vi.fn(() => createControllerForWorkspace(workspace));

    await expect(
      runWorkspaceCommand("missing", {
        store: createStore(config),
        output: { log: vi.fn() },
        createController,
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
    shutdown: vi.fn(async () => undefined),
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
