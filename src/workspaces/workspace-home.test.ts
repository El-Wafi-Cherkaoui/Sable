import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { AppConfig, WorkspaceConfig } from "../config/config-types.js";
import type { KeyInput } from "../input/terminal-key-input.js";
import type { RuntimeWorkspaceState } from "../runtime/runtime-state.js";
import type { RunWorkspaceController } from "./run-workspace.js";
import { runWorkspaceHome } from "./workspace-home.js";

describe("runWorkspaceHome", () => {
  it("opens the picker, runs the selected workspace, returns to picker, then exits", async () => {
    const keyInput = createKeyInput();
    const runPicker = vi
      .fn()
      .mockResolvedValueOnce({ type: "run", workspace })
      .mockResolvedValueOnce({ type: "exit" });
    const controller = createFakeController();
    const createController = vi.fn(() => controller);
    const runSession = vi.fn(async () => ({ type: "back" as const }));

    await runWorkspaceHome({
      store: createStore(config),
      keyInput,
      runPicker,
      runSession,
      createController,
    });

    expect(runPicker).toHaveBeenCalledTimes(2);
    expect(runPicker).toHaveBeenNthCalledWith(1, {
      workspaces: config.workspaces,
      keyInput,
      abortSignal: expect.any(AbortSignal),
      statusMessage: undefined,
      selectedWorkspaceId: undefined,
      activeWorkspaceId: undefined,
      startupMomentMs: 700,
      screen: undefined,
    });
    expect(runPicker).toHaveBeenNthCalledWith(2, expect.objectContaining({
      activeWorkspaceId: workspace.id,
      startupMomentMs: 0,
    }));
    expect(createController).toHaveBeenCalledOnce();
    expect(createController).toHaveBeenCalledWith(workspace);
    expect(runSession).toHaveBeenCalledWith({
      workspace,
      controller,
      keyInput,
      abortSignal: expect.any(AbortSignal),
      dashboardQuitLabel: "back",
      store: expect.any(Object),
      startAutoStartServices: true,
      shutdownOnReturn: false,
    });
    expect(controller.shutdown).toHaveBeenCalledOnce();
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
      activeWorkspaceId: workspace.id,
      statusMessage: undefined,
      selectedWorkspaceId: workspace.id,
    }));
  });

  it("exits the app when the workspace session exits", async () => {
    const runPicker = vi.fn(async () => ({ type: "run" as const, workspace }));
    const runSession = vi.fn(async () => ({ type: "exit" as const }));
    const controller = createFakeController();

    await runWorkspaceHome({
      store: createStore(config),
      keyInput: createKeyInput(),
      runPicker,
      runSession,
      createController: () => controller,
    });

    expect(runPicker).toHaveBeenCalledOnce();
    expect(controller.shutdown).toHaveBeenCalledOnce();
  });

  it("reopens the active workspace without restarting auto-start services", async () => {
    const controller = createFakeController();
    const runPicker = vi
      .fn()
      .mockResolvedValueOnce({ type: "run" as const, workspace })
      .mockResolvedValueOnce({ type: "run" as const, workspace })
      .mockResolvedValueOnce({ type: "exit" as const });
    const runSession = vi
      .fn()
      .mockResolvedValueOnce({ type: "back" as const })
      .mockResolvedValueOnce({ type: "back" as const });

    await runWorkspaceHome({
      store: createStore(config),
      keyInput: createKeyInput(),
      runPicker,
      runSession,
      createController: () => controller,
    });

    expect(runSession).toHaveBeenNthCalledWith(1, expect.objectContaining({
      controller,
      startAutoStartServices: true,
      shutdownOnReturn: false,
    }));
    expect(runSession).toHaveBeenNthCalledWith(2, expect.objectContaining({
      controller,
      startAutoStartServices: false,
      shutdownOnReturn: false,
    }));
    expect(runPicker).toHaveBeenNthCalledWith(2, expect.objectContaining({
      activeWorkspaceId: workspace.id,
    }));
    expect(controller.shutdown).toHaveBeenCalledOnce();
  });

  it("shuts down the active workspace before switching to another workspace", async () => {
    const ecommerceController = createFakeController();
    const portfolioController = createFakeController();
    const createController = vi
      .fn()
      .mockReturnValueOnce(ecommerceController)
      .mockReturnValueOnce(portfolioController);
    const runPicker = vi
      .fn()
      .mockResolvedValueOnce({ type: "run" as const, workspace })
      .mockResolvedValueOnce({ type: "run" as const, workspace: portfolioWorkspace })
      .mockResolvedValueOnce({ type: "exit" as const });
    const runSession = vi
      .fn()
      .mockResolvedValueOnce({ type: "back" as const })
      .mockResolvedValueOnce({ type: "back" as const });

    await runWorkspaceHome({
      store: createStore(configWithTwoWorkspaces),
      keyInput: createKeyInput(),
      runPicker,
      runSession,
      createController,
    });

    expect(createController).toHaveBeenNthCalledWith(1, workspace);
    expect(createController).toHaveBeenNthCalledWith(2, portfolioWorkspace);
    expect(runPicker).toHaveBeenNthCalledWith(2, expect.objectContaining({
      activeWorkspaceId: workspace.id,
    }));
    expect(runPicker).toHaveBeenNthCalledWith(3, expect.objectContaining({
      activeWorkspaceId: portfolioWorkspace.id,
    }));
    expect(ecommerceController.shutdown).toHaveBeenCalledOnce();
    expect(portfolioController.shutdown).toHaveBeenCalledOnce();
  });

  it("stops the selected active workspace from the picker", async () => {
    const controller = createFakeController();
    const runPicker = vi
      .fn()
      .mockResolvedValueOnce({ type: "run" as const, workspace })
      .mockResolvedValueOnce({ type: "stopActiveWorkspace" as const, workspace })
      .mockResolvedValueOnce({ type: "exit" as const });
    const runSession = vi.fn(async () => ({ type: "back" as const }));

    await runWorkspaceHome({
      store: createStore(config),
      keyInput: createKeyInput(),
      runPicker,
      runSession,
      createController: () => controller,
    });

    expect(controller.shutdown).toHaveBeenCalledOnce();
    expect(runPicker).toHaveBeenNthCalledWith(3, expect.objectContaining({
      activeWorkspaceId: undefined,
      selectedWorkspaceId: workspace.id,
      statusMessage: 'Stopped workspace "ecommerce".',
    }));
  });

  it("reports processes that fail to stop from the picker and warns on exit", async () => {
    const controller = createFakeController();
    controller.shutdown.mockResolvedValueOnce([
      { name: "api", pid: 1234, message: "Process did not stop." },
    ]);
    const keyInput = createKeyInput();
    const warn = vi.fn(() => {
      expect(keyInput.close).toHaveBeenCalledOnce();
    });
    const runPicker = vi
      .fn()
      .mockResolvedValueOnce({ type: "run" as const, workspace })
      .mockResolvedValueOnce({ type: "stopActiveWorkspace" as const, workspace })
      .mockResolvedValueOnce({ type: "exit" as const });

    await runWorkspaceHome({
      store: createStore(config),
      keyInput,
      runPicker,
      runSession: vi.fn(async () => ({ type: "back" as const })),
      createController: () => controller,
      warn,
    });

    expect(runPicker).toHaveBeenNthCalledWith(3, expect.objectContaining({
      statusMessage: 'Stopped workspace "ecommerce". Still running: api.',
    }));
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      'warning: "api" (pid 1234) may still be running: Process did not stop.',
    );
  });

  it("warns on exit when the active workspace fails to stop", async () => {
    const controller = createFakeController();
    controller.shutdown.mockResolvedValueOnce([
      { name: "api", message: "tree kill failed" },
    ]);
    const warn = vi.fn();
    const runPicker = vi
      .fn()
      .mockResolvedValueOnce({ type: "run" as const, workspace })
      .mockResolvedValueOnce({ type: "exit" as const });

    await runWorkspaceHome({
      store: createStore(config),
      keyInput: createKeyInput(),
      runPicker,
      runSession: vi.fn(async () => ({ type: "back" as const })),
      createController: () => controller,
      warn,
    });

    expect(warn).toHaveBeenCalledExactlyOnceWith('warning: "api" may still be running: tree kill failed');
  });

  it("does not stop a non-selected active workspace", async () => {
    const controller = createFakeController();
    const runPicker = vi
      .fn()
      .mockResolvedValueOnce({ type: "run" as const, workspace })
      .mockResolvedValueOnce({ type: "stopActiveWorkspace" as const, workspace: portfolioWorkspace })
      .mockResolvedValueOnce({ type: "exit" as const });
    const runSession = vi.fn(async () => ({ type: "back" as const }));

    await runWorkspaceHome({
      store: createStore(configWithTwoWorkspaces),
      keyInput: createKeyInput(),
      runPicker,
      runSession,
      createController: () => controller,
    });

    expect(controller.shutdown).toHaveBeenCalledOnce();
    expect(runPicker).toHaveBeenNthCalledWith(3, expect.objectContaining({
      activeWorkspaceId: workspace.id,
      selectedWorkspaceId: portfolioWorkspace.id,
      statusMessage: "Select the running workspace to stop it.",
    }));
  });

  it("restarts the selected active workspace with running and auto-start services", async () => {
    const oldController = createFakeController(createRuntimeStateForRestart());
    const newController = createFakeController();
    const createController = vi
      .fn()
      .mockReturnValueOnce(oldController)
      .mockReturnValueOnce(newController);
    const runPicker = vi
      .fn()
      .mockResolvedValueOnce({ type: "run" as const, workspace: restartWorkspace })
      .mockResolvedValueOnce({ type: "restartActiveWorkspace" as const, workspace: restartWorkspace })
      .mockResolvedValueOnce({ type: "exit" as const });
    const runSession = vi.fn(async () => ({ type: "back" as const }));

    await runWorkspaceHome({
      store: createStore(configForRestart),
      keyInput: createKeyInput(),
      runPicker,
      runSession,
      createController,
    });

    expect(oldController.shutdown).toHaveBeenCalledOnce();
    expect(createController).toHaveBeenNthCalledWith(2, restartWorkspace);
    expect(newController.startService).toHaveBeenCalledWith("svc_api");
    expect(newController.startService).toHaveBeenCalledWith("svc_worker");
    expect(newController.startService).not.toHaveBeenCalledWith("svc_web");
    // One-shot commands are not re-run on restart, even if they were running.
    expect(newController.startCommand).not.toHaveBeenCalled();
    expect(newController.shutdown).toHaveBeenCalledOnce();
    expect(runPicker).toHaveBeenNthCalledWith(3, expect.objectContaining({
      activeWorkspaceId: restartWorkspace.id,
      selectedWorkspaceId: restartWorkspace.id,
      statusMessage: 'Restarted workspace "ecommerce".',
    }));
  });

  it("does not restart a non-selected active workspace", async () => {
    const controller = createFakeController();
    const runPicker = vi
      .fn()
      .mockResolvedValueOnce({ type: "run" as const, workspace })
      .mockResolvedValueOnce({ type: "restartActiveWorkspace" as const, workspace: portfolioWorkspace })
      .mockResolvedValueOnce({ type: "exit" as const });
    const runSession = vi.fn(async () => ({ type: "back" as const }));

    await runWorkspaceHome({
      store: createStore(configWithTwoWorkspaces),
      keyInput: createKeyInput(),
      runPicker,
      runSession,
      createController: () => controller,
    });

    expect(controller.shutdown).toHaveBeenCalledOnce();
    expect(controller.startService).not.toHaveBeenCalled();
    expect(controller.startCommand).not.toHaveBeenCalled();
    expect(runPicker).toHaveBeenNthCalledWith(3, expect.objectContaining({
      activeWorkspaceId: workspace.id,
      selectedWorkspaceId: portfolioWorkspace.id,
      statusMessage: "Select the running workspace to restart it.",
    }));
  });

  it("reports when stop or restart is requested without an active workspace", async () => {
    const runPicker = vi
      .fn()
      .mockResolvedValueOnce({ type: "stopActiveWorkspace" as const, workspace })
      .mockResolvedValueOnce({ type: "restartActiveWorkspace" as const, workspace })
      .mockResolvedValueOnce({ type: "exit" as const });

    await runWorkspaceHome({
      store: createStore(config),
      keyInput: createKeyInput(),
      runPicker,
      runSession: vi.fn(),
    });

    expect(runPicker).toHaveBeenNthCalledWith(2, expect.objectContaining({
      activeWorkspaceId: undefined,
      statusMessage: "No workspace is running.",
    }));
    expect(runPicker).toHaveBeenNthCalledWith(3, expect.objectContaining({
      activeWorkspaceId: undefined,
      statusMessage: "No workspace is running.",
    }));
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

  it("saves a workspace's new position from the picker", async () => {
    const store = createStore(configWithTwoWorkspaces);
    const runPicker = vi
      .fn()
      .mockResolvedValueOnce({ type: "reorderWorkspace", workspace: portfolioWorkspace, index: 0 })
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
      statusMessage: 'Moved workspace "portfolio".',
      selectedWorkspaceId: "ws_portfolio",
    }));
  });

  it("moves a workspace down to a later position", async () => {
    const store = createStore(configWithTwoWorkspaces);
    const runPicker = vi
      .fn()
      .mockResolvedValueOnce({ type: "reorderWorkspace", workspace, index: 1 })
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
      statusMessage: 'Moved workspace "ecommerce".',
      selectedWorkspaceId: "ws_ecommerce",
    }));
  });

  it("clamps a workspace position beyond the list boundary", async () => {
    const store = createStore(configWithTwoWorkspaces);
    const runPicker = vi
      .fn()
      .mockResolvedValueOnce({ type: "reorderWorkspace", workspace, index: 5 })
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

  it("refuses to delete the active workspace and keeps it running", async () => {
    const controller = createFakeController();
    const runDeleteWorkspace = vi.fn();
    const runPicker = vi
      .fn()
      .mockResolvedValueOnce({ type: "run" as const, workspace })
      .mockResolvedValueOnce({ type: "deleteWorkspace" as const, workspace })
      .mockResolvedValueOnce({ type: "exit" as const });

    await runWorkspaceHome({
      store: createStore(config),
      keyInput: createKeyInput(),
      runPicker,
      runSession: vi.fn(async () => ({ type: "back" as const })),
      runDeleteWorkspace,
      createController: () => controller,
    });

    expect(runDeleteWorkspace).not.toHaveBeenCalled();
    expect(runPicker).toHaveBeenNthCalledWith(3, expect.objectContaining({
      activeWorkspaceId: workspace.id,
      selectedWorkspaceId: workspace.id,
      statusMessage: 'Stop workspace "ecommerce" before deleting it.',
    }));
    // Only the final cleanup shuts the controller down.
    expect(controller.shutdown).toHaveBeenCalledOnce();
  });

  it("deletes a non-active workspace while another workspace is active", async () => {
    const controller = createFakeController();
    const runDeleteWorkspace = vi.fn(async () => ({
      type: "completed" as const,
      selectedWorkspaceId: undefined,
      message: "Deleted workspace.",
    }));
    const runPicker = vi
      .fn()
      .mockResolvedValueOnce({ type: "run" as const, workspace })
      .mockResolvedValueOnce({ type: "deleteWorkspace" as const, workspace: portfolioWorkspace })
      .mockResolvedValueOnce({ type: "exit" as const });

    await runWorkspaceHome({
      store: createStore(configWithTwoWorkspaces),
      keyInput: createKeyInput(),
      runPicker,
      runSession: vi.fn(async () => ({ type: "back" as const })),
      runDeleteWorkspace,
      createController: () => controller,
    });

    expect(runDeleteWorkspace).toHaveBeenCalledWith(expect.objectContaining({
      workspace: portfolioWorkspace,
    }));
    expect(runPicker).toHaveBeenNthCalledWith(3, expect.objectContaining({
      activeWorkspaceId: workspace.id,
      statusMessage: "Deleted workspace.",
    }));
  });

  it.each([
    ["create", { type: "createWorkspace" as const }, "runCreateWorkspace", undefined],
    ["delete", { type: "deleteWorkspace" as const, workspace: portfolioWorkspace }, "runDeleteWorkspace", "ws_portfolio"],
    ["rename", { type: "renameWorkspace" as const, workspace: portfolioWorkspace }, "runRenameWorkspace", "ws_portfolio"],
  ])("shows a status message when the %s flow fails to update config", async (_name, pickerResult, flowOption, selectedId) => {
    const controller = createFakeController();
    const runPicker = vi
      .fn()
      .mockResolvedValueOnce({ type: "run" as const, workspace })
      .mockResolvedValueOnce(pickerResult)
      .mockResolvedValueOnce({ type: "exit" as const });

    await runWorkspaceHome({
      store: createStore(configWithTwoWorkspaces),
      keyInput: createKeyInput(),
      runPicker,
      runSession: vi.fn(async () => ({ type: "back" as const })),
      createController: () => controller,
      [flowOption]: vi.fn(async () => {
        throw new Error("disk full");
      }),
    });

    expect(runPicker).toHaveBeenNthCalledWith(3, expect.objectContaining({
      activeWorkspaceId: workspace.id,
      selectedWorkspaceId: selectedId,
      statusMessage: "Could not update config: disk full",
    }));
    expect(controller.shutdown).toHaveBeenCalledOnce();
  });

  it("shows a status message when moving a workspace fails to save", async () => {
    const controller = createFakeController();
    const store = {
      ...createStore(configWithTwoWorkspaces),
      async save() {
        throw new Error("read-only file system");
      },
    };
    const runPicker = vi
      .fn()
      .mockResolvedValueOnce({ type: "run" as const, workspace })
      .mockResolvedValueOnce({ type: "reorderWorkspace" as const, workspace: portfolioWorkspace, index: 0 })
      .mockResolvedValueOnce({ type: "exit" as const });

    await runWorkspaceHome({
      store,
      keyInput: createKeyInput(),
      runPicker,
      runSession: vi.fn(async () => ({ type: "back" as const })),
      createController: () => controller,
    });

    expect(runPicker).toHaveBeenNthCalledWith(3, expect.objectContaining({
      activeWorkspaceId: workspace.id,
      selectedWorkspaceId: "ws_portfolio",
      statusMessage: "Could not update config: read-only file system",
    }));
    expect(controller.shutdown).toHaveBeenCalledOnce();
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

function createFakeController(state?: RuntimeWorkspaceState): RunWorkspaceController {
  const defaultState: RuntimeWorkspaceState = {
    workspace: { id: workspace.id, name: workspace.name },
    services: [],
    commands: [],
    selectedServiceIndex: undefined,
    selectedCommandIndex: undefined,
    serviceIndexById: {},
    commandIndexById: {},
    selectedItem: undefined,
  };

  return {
    startAutoStartServices: vi.fn(async () => undefined),
    getState: vi.fn(() => state ?? defaultState),
    selectNextService: vi.fn(),
    selectPreviousService: vi.fn(),
    startSelectedService: vi.fn(async () => ({ status: "stopped" as const })),
    stopSelectedService: vi.fn(async () => ({ status: "stopped" as const })),
    restartSelectedService: vi.fn(async () => ({ status: "stopped" as const })),
    startService: vi.fn(async () => ({ status: "stopped" as const })),
    startCommand: vi.fn(async () => ({ status: "stopped" as const })),
    addService: vi.fn(),
    addCommand: vi.fn(),
    updateService: vi.fn(),
    updateCommand: vi.fn(),
    removeService: vi.fn(),
    removeCommand: vi.fn(),
    moveService: vi.fn(),
    getSelectedServiceLogs: vi.fn(() => []),
    shutdown: vi.fn(async () => []),
  };
}

function createRuntimeStateForRestart(): RuntimeWorkspaceState {
  const runningState = { status: "running" as const };
  const stoppedState = { status: "stopped" as const };
  const services = restartWorkspace.services.map((service) => ({
    service,
    process:
      service.id === "svc_web" ? stoppedState : runningState,
  }));
  const commands = restartWorkspace.commands.map((command) => ({
    command,
    process: command.id === "cmd_build" ? stoppedState : runningState,
  }));

  return {
    workspace: { id: restartWorkspace.id, name: restartWorkspace.name },
    services,
    commands,
    serviceIndexById: Object.fromEntries(
      services.map((serviceState, index) => [serviceState.service.id, index]),
    ),
    commandIndexById: Object.fromEntries(
      commands.map((commandState, index) => [commandState.command.id, index]),
    ),
    selectedServiceIndex: 0,
    selectedCommandIndex: undefined,
    selectedItem: { type: "service", index: 0 },
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

const restartWorkspace: WorkspaceConfig = {
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
    {
      id: "svc_worker",
      name: "worker",
      command: "npm run worker",
      cwd: process.cwd(),
      autoStart: false,
      env: {},
    },
    {
      id: "svc_web",
      name: "web",
      command: "npm run web",
      cwd: process.cwd(),
      autoStart: false,
      env: {},
    },
  ],
  commands: [
    {
      id: "cmd_watch",
      name: "watch",
      command: "npm run watch",
      cwd: process.cwd(),
      env: {},
    },
    {
      id: "cmd_build",
      name: "build",
      command: "npm run build",
      cwd: process.cwd(),
      env: {},
    },
  ],
};

const configForRestart: AppConfig = {
  version: 1,
  workspaces: [restartWorkspace],
};
