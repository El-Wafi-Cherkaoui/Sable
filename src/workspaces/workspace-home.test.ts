import { EventEmitter } from "node:events";
import { promises as fsPromises } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AppConfig, WorkspaceConfig } from "../config/config-types.js";
import type { KeyInput } from "../input/terminal-key-input.js";
import type { RuntimeWorkspaceState } from "../runtime/runtime-state.js";
import type { RunWorkspaceController } from "./run-workspace.js";
import { runWorkspaceHome } from "./workspace-home.js";
import { commandsOf, servicesOf } from "../config/workspace-items.js";

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
      startupMomentMs: 1_800,
      afterStartup: expect.any(Function),
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

  it("opens a newly created workspace directly and clears the status on return", async () => {
    const runPicker = vi
      .fn()
      .mockResolvedValueOnce({ type: "createWorkspace" })
      .mockResolvedValueOnce({ type: "exit" });
    const runCreateWorkspace = vi.fn(async () => ({
      type: "completed" as const,
      workspaceId: workspace.id,
      message: "Created workspace.",
    }));
    const runSuggestServices = vi.fn(async () => ({ type: "skipped" as const }));
    const runSession = vi.fn(async () => ({ type: "back" as const }));

    await runWorkspaceHome({
      store: createStore(config),
      keyInput: createKeyInput(),
      runPicker,
      runCreateWorkspace,
      runSuggestServices,
      runSession,
    });

    expect(runSuggestServices).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: workspace.id }));
    expect(runSession).toHaveBeenCalledWith(expect.objectContaining({
      workspace,
      initialMessage: "Created workspace. Press a to add a service.",
    }));
    expect(runPicker).toHaveBeenCalledTimes(2);
    expect(runPicker).toHaveBeenNthCalledWith(2, expect.objectContaining({
      activeWorkspaceId: workspace.id,
      statusMessage: undefined,
      selectedWorkspaceId: workspace.id,
    }));
  });

  it("shows what was added from package.json when the new workspace opens", async () => {
    const runSession = vi.fn(async () => ({ type: "exit" as const }));

    await runWorkspaceHome({
      store: createStore(config),
      keyInput: createKeyInput(),
      runPicker: vi.fn().mockResolvedValueOnce({ type: "createWorkspace" }),
      runCreateWorkspace: vi.fn(async () => ({ type: "completed" as const, workspaceId: workspace.id, message: "Created." })),
      runSuggestServices: vi.fn(async () => ({ type: "added" as const, message: "Added 2 services from package.json." })),
      runSession,
    });

    expect(runSession).toHaveBeenCalledWith(expect.objectContaining({ initialMessage: "Added 2 services from package.json." }));
  });

  it("exits when Sable is quit from the suggestions screen", async () => {
    const runSession = vi.fn();

    await runWorkspaceHome({
      store: createStore(config),
      keyInput: createKeyInput(),
      runPicker: vi.fn().mockResolvedValueOnce({ type: "createWorkspace" }),
      runCreateWorkspace: vi.fn(async () => ({ type: "completed" as const, workspaceId: workspace.id, message: "Created." })),
      runSuggestServices: vi.fn(async () => ({ type: "exit" as const })),
      runSession,
    });

    expect(runSession).not.toHaveBeenCalled();
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
    // The running and auto-start services come back together, so their order of dependencies is kept.
    expect(newController.startPlan).toHaveBeenCalledTimes(1);
    expect(newController.startPlan.mock.calls[0]![0].sort()).toEqual(["svc_api", "svc_worker"]);
    // One-shot commands are not re-run on restart, even if they were running.
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
    expect(controller.startPlan).not.toHaveBeenCalled();
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

  it("asks the picker to show the update popup at launch, and remembers OK", async () => {
    const dismiss = vi.fn(async () => {});
    const dialog = vi.fn(async () => "ok" as const);
    let afterStartupOutcome: string | undefined;
    const runPicker = vi.fn(async (pickerOptions: { afterStartup?: () => Promise<string> }) => {
      afterStartupOutcome = await pickerOptions.afterStartup?.();
      return { type: "exit" as const };
    });

    const result = await runWorkspaceHome({
      store: createStore(config),
      keyInput: createKeyInput(),
      runPicker,
      runSession: vi.fn(),
      update: { latestVersion: () => "0.4.0", currentVersion: "0.3.0", installCommand: "npm install -g sable-workspaces@latest", dismiss, dialog },
    });

    expect(dialog).toHaveBeenCalledWith(expect.objectContaining({ latestVersion: "0.4.0", currentVersion: "0.3.0" }));
    expect(afterStartupOutcome).toBe("continue");
    expect(dismiss).toHaveBeenCalledWith("0.4.0");
    expect(result).toEqual({ type: "quit" });
  });

  it("goes straight to the list when the welcome screen is off, but still offers an update once", async () => {
    const dialog = vi.fn(async () => "ok" as const);
    const pickerOptions: Array<{ startupMomentMs?: number; afterStartup?: unknown }> = [];
    const runPicker = vi.fn(async (options: { startupMomentMs?: number; afterStartup?: () => Promise<string> }) => {
      pickerOptions.push({ startupMomentMs: options.startupMomentMs, afterStartup: options.afterStartup });
      await options.afterStartup?.();

      return pickerOptions.length === 1
        ? { type: "run" as const, workspace: config.workspaces[0]! }
        : { type: "exit" as const };
    });

    await runWorkspaceHome({
      store: createStore(config),
      keyInput: createKeyInput(),
      runPicker,
      runSession: vi.fn(async () => ({ type: "back" as const })),
      createController: vi.fn(() => createFakeController()),
      welcomeScreen: false,
      update: { latestVersion: () => "0.4.0", currentVersion: "0.3.0", installCommand: "npm i", dismiss: vi.fn(), dialog },
    });

    expect(pickerOptions[0]!.startupMomentMs).toBe(0);
    expect(pickerOptions[0]!.afterStartup).toBeDefined();
    expect(pickerOptions[1]!.afterStartup).toBeUndefined();
    expect(dialog).toHaveBeenCalledOnce();
  });

  describe("the upgrade notice", () => {
    const notice = { backupFile: "/home/me/.config/sable-nodejs/workspaces.json.bak-0.3", backedUp: true, converted: true };
    const storeWith = (taken: Array<typeof notice | undefined>) => ({
      ...createStore(config),
      takeUpgradeNotice: vi.fn(() => taken.shift()),
    });
    const startupPicker = () => vi.fn(async (options: { afterStartup?: () => Promise<string> }) => {
      await options.afterStartup?.();

      return { type: "exit" as const };
    });

    it("tells the user once at launch, before any update popup, with where the old file went", async () => {
      const order: string[] = [];
      const showNotice = vi.fn(async (_options: { title: string; paragraphs: string[] }) => {
        order.push("notice");

        return "ok" as const;
      });
      const dialog = vi.fn(async () => {
        order.push("update");

        return "ok" as const;
      });

      await runWorkspaceHome({
        store: storeWith([notice]),
        keyInput: createKeyInput(),
        runPicker: startupPicker(),
        runSession: vi.fn(),
        showNotice,
        update: { latestVersion: () => "0.5.0", currentVersion: "0.4.0", installCommand: "npm i", dismiss: vi.fn(), dialog },
      });

      expect(order).toEqual(["notice", "update"]);
      expect(showNotice.mock.calls[0]![0].title).toBe("Your workspaces were upgraded");
      expect(showNotice.mock.calls[0]![0].paragraphs.join(" ")).toContain("workspaces.json.bak-0.3");
    });

    it("says nothing when the file was not just upgraded", async () => {
      const showNotice = vi.fn(async () => "ok" as const);

      await runWorkspaceHome({ store: storeWith([undefined]), keyInput: createKeyInput(), runPicker: startupPicker(), runSession: vi.fn(), showNotice });
      await runWorkspaceHome({ store: createStore(config), keyInput: createKeyInput(), runPicker: startupPicker(), runSession: vi.fn(), showNotice });

      expect(showNotice).not.toHaveBeenCalled();
    });

    it("shows it even when the welcome screen is off", async () => {
      const showNotice = vi.fn(async () => "ok" as const);

      await runWorkspaceHome({ store: storeWith([notice]), keyInput: createKeyInput(), runPicker: startupPicker(), runSession: vi.fn(), showNotice, welcomeScreen: false });

      expect(showNotice).toHaveBeenCalledOnce();
    });

    it("quits when the user presses Ctrl+C on it", async () => {
      const runPicker = vi.fn(async (options: { afterStartup?: () => Promise<string> }) => ({ type: (await options.afterStartup?.()) === "exit" ? "exit" as const : "run" as const, workspace: config.workspaces[0]! }));
      const dialog = vi.fn(async () => "ok" as const);

      await runWorkspaceHome({
        store: storeWith([notice]),
        keyInput: createKeyInput(),
        runPicker,
        runSession: vi.fn(),
        showNotice: vi.fn(async () => "exit" as const),
        update: { latestVersion: () => "0.5.0", currentVersion: "0.4.0", installCommand: "npm i", dismiss: vi.fn(), dialog },
      });

      expect(dialog).not.toHaveBeenCalled();
    });
  });

  it("returns an update request when the user picks Update now", async () => {
    const runPicker = vi.fn(async () => ({ type: "update" as const }));

    await expect(runWorkspaceHome({
      store: createStore(config),
      keyInput: createKeyInput(),
      runPicker,
      runSession: vi.fn(),
      update: { latestVersion: () => "0.4.0", currentVersion: "0.3.0", installCommand: "npm i", dismiss: vi.fn() },
    })).resolves.toEqual({ type: "update", version: "0.4.0" });
  });

  it("skips the popup when no newer version is known", async () => {
    const dialog = vi.fn();
    let afterStartupOutcome: string | undefined;

    await runWorkspaceHome({
      store: createStore(config),
      keyInput: createKeyInput(),
      runPicker: vi.fn(async (pickerOptions: { afterStartup?: () => Promise<string> }) => {
        afterStartupOutcome = await pickerOptions.afterStartup?.();
        return { type: "exit" as const };
      }),
      runSession: vi.fn(),
      update: { latestVersion: () => undefined, currentVersion: "0.3.0", installCommand: "npm i", dismiss: vi.fn(), dialog },
    });

    expect(dialog).not.toHaveBeenCalled();
    expect(afterStartupOutcome).toBe("continue");
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
    expect(signalSource.listenerCount("SIGHUP")).toBe(0);
  });

  it("aborts picker wait on SIGHUP", async () => {
    const signalSource = createSignalSource();
    const runPicker = vi.fn(
      async ({ abortSignal }: { abortSignal?: AbortSignal }) =>
        new Promise<{ type: "exit" }>((resolve) => {
          abortSignal?.addEventListener("abort", () => resolve({ type: "exit" }), { once: true });
        }),
    );

    const runPromise = runWorkspaceHome({
      store: createStore(config),
      keyInput: createKeyInput(),
      runPicker,
      runSession: vi.fn(),
      signalSource,
    });

    await waitUntil(() => runPicker.mock.calls.length === 1);
    signalSource.emit("SIGHUP");

    await expect(runPromise).resolves.toEqual({ type: "quit" });
  });
});

describe("runWorkspaceHome with a sable.json", () => {
  const folder = "/projects/shop";
  const found = { type: "ok" as const, file: { version: 1 as const, placeholders: {}, items: [] }, hash: "h" };
  const linkedWorkspace: WorkspaceConfig = {
    ...workspace,
    id: "ws_shop",
    name: "shop",
    projectDirectory: folder,
    project: { hash: "old", values: {}, base: {}, removed: [] },
  };

  function homeOptions(overrides: Record<string, unknown> = {}) {
    return {
      keyInput: createKeyInput(),
      runPicker: vi.fn().mockResolvedValue({ type: "exit" }),
      runSession: vi.fn(async () => ({ type: "back" as const })),
      createController: vi.fn(() => createFakeController()),
      launchDirectory: folder,
      readProjectFile: vi.fn(async () => found),
      runImportProject: vi.fn(async () => ({ type: "completed" as const, message: 'Imported "shop" from sable.json: 1 service.', workspaceId: "ws_new" })),
      runUpdateProject: vi.fn(async () => ({ type: "unchanged" as const })),
      ...overrides,
    };
  }

  it("offers to import a sable.json in the launch folder that has no workspace yet, and selects what was imported", async () => {
    const options = homeOptions();

    await runWorkspaceHome({ store: createStore(config), ...options });

    expect(options.runImportProject).toHaveBeenCalledWith(expect.objectContaining({ directory: folder }));
    expect(options.runUpdateProject).not.toHaveBeenCalled();
    expect(options.runPicker).toHaveBeenCalledWith(expect.objectContaining({
      statusMessage: 'Imported "shop" from sable.json: 1 service.',
      selectedWorkspaceId: "ws_new",
      projectFileHere: true,
    }));
  });

  it("does nothing at launch without a sable.json, or when the folder already has a workspace made by hand", async () => {
    const missing = homeOptions({ readProjectFile: vi.fn(async () => ({ type: "missing" as const })) });

    await runWorkspaceHome({ store: createStore(config), ...missing });
    expect(missing.runImportProject).not.toHaveBeenCalled();
    expect(missing.runPicker).toHaveBeenCalledWith(expect.not.objectContaining({ projectFileHere: true }));

    const madeByHand = homeOptions();

    await runWorkspaceHome({ store: createStore({ version: 2, workspaces: [{ ...workspace, projectDirectory: folder }] }), ...madeByHand });
    expect(madeByHand.runImportProject).not.toHaveBeenCalled();
    expect(madeByHand.runUpdateProject).not.toHaveBeenCalled();
  });

  it("checks a workspace that is already linked to the folder for changes instead of importing again", async () => {
    const options = homeOptions({ runUpdateProject: vi.fn(async () => ({ type: "completed" as const, message: 'Updated "shop" from sable.json: 1 changed.', workspaceId: "ws_shop" })) });

    await runWorkspaceHome({ store: createStore({ version: 2, workspaces: [linkedWorkspace] }), ...options });

    expect(options.runUpdateProject).toHaveBeenCalledWith(expect.objectContaining({ workspace: linkedWorkspace }));
    expect(options.runImportProject).not.toHaveBeenCalled();
    expect(options.runPicker).toHaveBeenCalledWith(expect.objectContaining({ statusMessage: 'Updated "shop" from sable.json: 1 changed.', selectedWorkspaceId: "ws_shop" }));
  });

  it("shows what is wrong with a broken sable.json, and quits when the review is answered with Ctrl+C", async () => {
    const broken = homeOptions({ readProjectFile: vi.fn(async () => ({ type: "invalid" as const, message: "sable.json has problems:\n  - items.0.command: Every item needs a command." })) });

    await runWorkspaceHome({ store: createStore(config), ...broken });
    expect(broken.runPicker).toHaveBeenCalledWith(expect.objectContaining({ statusMessage: "sable.json has problems: - items.0.command: Every item needs a command." }));

    const quitting = homeOptions({ runImportProject: vi.fn(async () => ({ type: "exit" as const })) });

    await expect(runWorkspaceHome({ store: createStore(config), ...quitting })).resolves.toEqual({ type: "quit" });
    expect(quitting.runPicker).not.toHaveBeenCalled();
  });

  it("imports with the i key from the picker", async () => {
    const options = homeOptions({
      runPicker: vi.fn().mockResolvedValueOnce({ type: "importProject" }).mockResolvedValueOnce({ type: "exit" }),
      readProjectFile: vi.fn(async () => ({ type: "missing" as const })),
      runImportProject: vi.fn(async () => ({ type: "back" as const, message: "There is no sable.json in /projects/shop." })),
    });

    await runWorkspaceHome({ store: createStore(config), ...options });

    expect(options.runImportProject).toHaveBeenCalledOnce();
    expect(options.runPicker).toHaveBeenNthCalledWith(2, expect.objectContaining({ statusMessage: "There is no sable.json in /projects/shop." }));
  });

  it("writes a sable.json for the selected workspace with the x key and keeps it selected", async () => {
    const options = homeOptions({
      launchDirectory: undefined,
      runPicker: vi.fn().mockResolvedValueOnce({ type: "exportProject", workspace }).mockResolvedValueOnce({ type: "exit" }),
      runExportProject: vi.fn(async () => ({ type: "completed" as const, message: "Wrote sable.json (1 service). Commit it so your team gets the same workspace.", workspaceId: workspace.id })),
    });

    await runWorkspaceHome({ store: createStore(config), ...options });

    expect(options.runExportProject).toHaveBeenCalledWith(expect.objectContaining({ workspace }));
    expect(options.runPicker).toHaveBeenNthCalledWith(2, expect.objectContaining({
      statusMessage: "Wrote sable.json (1 service). Commit it so your team gets the same workspace.",
      selectedWorkspaceId: workspace.id,
    }));
  });

  describe("the share tip", () => {
    const tipsOn = { sound: { play: vi.fn(), close: vi.fn(), isEnabled: () => false, setEnabled: vi.fn() }, welcomeScreen: { isEnabled: () => false, setEnabled: vi.fn() }, persistLogs: { isEnabled: () => false, setEnabled: vi.fn() }, tips: { isEnabled: () => true, setEnabled: vi.fn() } };
    const tipsOff = { ...tipsOn, tips: { isEnabled: () => false, setEnabled: vi.fn() } };
    const second: WorkspaceConfig = { ...workspace, id: "ws_second", name: "second" };
    const twoWorkspaces: AppConfig = { version: 2, workspaces: [workspace, second] };

    it("tells the list which workspaces could be shared, according to the check", async () => {
      const runPicker = vi.fn().mockResolvedValue({ type: "exit" });
      const canSuggestSharing = vi.fn(async (candidate: WorkspaceConfig) => candidate.id === "ws_second");

      await runWorkspaceHome({ store: createStore(twoWorkspaces), keyInput: createKeyInput(), runPicker, runSession: vi.fn(), settings: tipsOn, canSuggestSharing });

      expect(runPicker).toHaveBeenCalledWith(expect.objectContaining({ shareTipIds: ["ws_second"] }));
    });

    it("gives no tips while they are switched off, or when there are no settings", async () => {
      const canSuggestSharing = vi.fn(async () => true);

      for (const settings of [tipsOff, undefined]) {
        const runPicker = vi.fn().mockResolvedValue({ type: "exit" });

        await runWorkspaceHome({ store: createStore(twoWorkspaces), keyInput: createKeyInput(), runPicker, runSession: vi.fn(), settings, canSuggestSharing });

        expect(runPicker.mock.calls[0]![0].shareTipIds).toBeUndefined();
      }

      expect(canSuggestSharing).not.toHaveBeenCalled();
    });

    it("by default suggests it for a workspace with items whose folder has no sable.json, and for no other", async () => {
      const root = await fsPromises.mkdtemp(path.join(os.tmpdir(), "sable-share-tip-"));
      const folder = async (name: string, withFile: boolean) => {
        const directory = path.join(root, name);

        await fsPromises.mkdir(directory);

        if (withFile) {
          await fsPromises.writeFile(path.join(directory, "sable.json"), "{}");
        }

        return directory;
      };
      const item = { kind: "service" as const, after: [], id: "svc", name: "api", command: "x", cwd: root, autoStart: true, env: {} };
      const candidates: WorkspaceConfig[] = [
        { id: "plain", name: "plain", projectDirectory: await folder("plain", false), items: [item] },
        { id: "shared", name: "shared", projectDirectory: await folder("shared", true), items: [item] },
        { id: "empty", name: "empty", projectDirectory: await folder("empty", false), items: [] },
        { id: "gone", name: "gone", projectDirectory: path.join(root, "not-there"), items: [item] },
      ];
      const runPicker = vi.fn().mockResolvedValue({ type: "exit" });

      try {
        await runWorkspaceHome({ store: createStore({ version: 2, workspaces: candidates }), keyInput: createKeyInput(), runPicker, runSession: vi.fn(), settings: tipsOn });

        expect(runPicker.mock.calls[0]![0].shareTipIds).toEqual(["plain"]);
      } finally {
        await fsPromises.rm(root, { recursive: true, force: true });
      }
    });
  });

  describe("a changed sable.json", () => {
    const linked = (id: string, hash: string): WorkspaceConfig => ({ ...workspace, id, name: id, project: { hash, values: {}, base: {}, removed: [] } });

    it("by default compares each linked workspace's file hash with the approved one", async () => {
      const root = await fsPromises.mkdtemp(path.join(os.tmpdir(), "sable-changed-"));
      const write = async (name: string, content: unknown) => {
        const directory = path.join(root, name);

        await fsPromises.mkdir(directory);
        await fsPromises.writeFile(path.join(directory, "sable.json"), JSON.stringify(content));

        return directory;
      };
      const { parseProjectFile } = await import("../project/project-file.js");
      const original = { version: 1, items: [{ type: "service", name: "a", command: "x" }] };
      const approved = parseProjectFile(JSON.stringify(original));
      const hash = approved.type === "ok" ? approved.hash : "";
      const workspaces: WorkspaceConfig[] = [
        { ...linked("same", hash), projectDirectory: await write("same", original) },
        { ...linked("changed", hash), projectDirectory: await write("changed", { ...original, items: [{ type: "service", name: "a", command: "rm -rf /" }] }) },
        { ...linked("broken", hash), projectDirectory: await write("broken", { nope: true }) },
        { ...linked("gone", hash), projectDirectory: path.join(root, "gone") },
        { ...workspace, id: "plain", name: "plain", projectDirectory: await write("plain", original) },
      ];
      const runPicker = vi.fn().mockResolvedValue({ type: "exit" });

      try {
        await runWorkspaceHome({ store: createStore({ version: 2, workspaces }), keyInput: createKeyInput(), runPicker, runSession: vi.fn() });

        expect(runPicker.mock.calls[0]![0].projectChangedIds).toEqual(["changed"]);
      } finally {
        await fsPromises.rm(root, { recursive: true, force: true });
      }
    });
  });

  it("opens the saved logs from the list with L and passes the workspaces and the running one", async () => {
    const showSavedLogs = vi.fn(async () => "close" as const);
    const runPicker = vi.fn()
      .mockResolvedValueOnce({ type: "run", workspace })
      .mockResolvedValueOnce({ type: "savedLogs", background: "THE LIST" })
      .mockResolvedValueOnce({ type: "exit" });
    const controller = createFakeController();

    await runWorkspaceHome({
      store: createStore(config),
      keyInput: createKeyInput(),
      runPicker,
      runSession: vi.fn(async () => ({ type: "back" as const })),
      createController: vi.fn(() => controller),
      logFiles: { totalUsage: async () => ({ bytes: 0, files: 0 }), workspaceUsage: async () => ({ bytes: 0, files: 0 }) } as never,
      showSavedLogs,
    });

    expect(showSavedLogs).toHaveBeenCalledOnce();
    expect(showSavedLogs).toHaveBeenCalledWith(expect.objectContaining({ title: "Saved logs", background: "THE LIST" }));
    expect(runPicker).toHaveBeenCalledTimes(3);
  });

  it("hands the log files to the dashboard session, which needs them to manage saved logs", async () => {
    const logFiles = { totalUsage: vi.fn() } as never;
    const runSession = vi.fn(async () => ({ type: "back" as const }));
    const runPicker = vi.fn().mockResolvedValueOnce({ type: "run", workspace }).mockResolvedValueOnce({ type: "exit" });

    await runWorkspaceHome({ store: createStore(config), keyInput: createKeyInput(), runPicker, runSession, createController: vi.fn(() => createFakeController()), logFiles });

    expect(runSession).toHaveBeenCalledWith(expect.objectContaining({ logFiles }));
  });

  it("says saved logs are not available when Sable has no log files to manage", async () => {
    const runPicker = vi.fn().mockResolvedValueOnce({ type: "savedLogs" }).mockResolvedValueOnce({ type: "exit" });

    await runWorkspaceHome({ store: createStore(config), keyInput: createKeyInput(), runPicker, runSession: vi.fn() });

    expect(runPicker).toHaveBeenNthCalledWith(2, expect.objectContaining({ statusMessage: "Saved logs are not available here." }));
  });

  it("quits when the saved logs popup is closed with Ctrl+C", async () => {
    const runPicker = vi.fn().mockResolvedValueOnce({ type: "savedLogs" });

    await expect(runWorkspaceHome({
      store: createStore(config),
      keyInput: createKeyInput(),
      runPicker,
      runSession: vi.fn(),
      logFiles: {} as never,
      showSavedLogs: vi.fn(async () => "exit" as const),
    })).resolves.toEqual({ type: "quit" });
  });

  it("checks the file again when a linked workspace is opened, and opens the updated workspace with a message", async () => {
    const updated = { ...linkedWorkspace, items: [{ kind: "command" as const, after: [], id: "cmd_new", name: "seed", command: "npm run seed", cwd: folder, env: {} }] };
    let stored: AppConfig = { version: 2, workspaces: [linkedWorkspace] };
    const store = { async load() { return stored; }, async save(next: AppConfig) { stored = next; } };
    const options = homeOptions({
      launchDirectory: undefined,
      runPicker: vi.fn().mockResolvedValueOnce({ type: "run", workspace: linkedWorkspace }).mockResolvedValueOnce({ type: "exit" }),
      runUpdateProject: vi.fn(async () => {
        stored = { version: 2, workspaces: [updated] };

        return { type: "completed" as const, message: 'Updated "shop" from sable.json: 1 added.', workspaceId: "ws_shop" };
      }),
    });

    await runWorkspaceHome({ store, ...options });

    expect(options.createController).toHaveBeenCalledWith(updated);
    expect(options.runSession).toHaveBeenCalledWith(expect.objectContaining({ workspace: updated, initialMessage: 'Updated "shop" from sable.json: 1 added.' }));
  });

  it("opens the old settings when the user says not now, and still opens a workspace whose file has not changed", async () => {
    const declined = homeOptions({
      launchDirectory: undefined,
      runPicker: vi.fn().mockResolvedValueOnce({ type: "run", workspace: linkedWorkspace }).mockResolvedValueOnce({ type: "exit" }),
      runUpdateProject: vi.fn(async () => ({ type: "back" as const, message: 'Kept "shop" as it was. Open it again to update.' })),
    });

    await runWorkspaceHome({ store: createStore({ version: 2, workspaces: [linkedWorkspace] }), ...declined });
    expect(declined.runSession).toHaveBeenCalledWith(expect.objectContaining({ workspace: linkedWorkspace, initialMessage: 'Kept "shop" as it was. Open it again to update.' }));

    const unchanged = homeOptions({
      launchDirectory: undefined,
      runPicker: vi.fn().mockResolvedValueOnce({ type: "run", workspace: linkedWorkspace }).mockResolvedValueOnce({ type: "exit" }),
    });

    await runWorkspaceHome({ store: createStore({ version: 2, workspaces: [linkedWorkspace] }), ...unchanged });
    expect(unchanged.runSession).toHaveBeenCalledWith(expect.objectContaining({ workspace: linkedWorkspace }));
  });

  it("does not swap the settings of a workspace that is already running", async () => {
    const options = homeOptions({
      launchDirectory: undefined,
      runPicker: vi.fn()
        .mockResolvedValueOnce({ type: "run", workspace: linkedWorkspace })
        .mockResolvedValueOnce({ type: "run", workspace: linkedWorkspace })
        .mockResolvedValueOnce({ type: "exit" }),
    });

    await runWorkspaceHome({ store: createStore({ version: 2, workspaces: [linkedWorkspace] }), ...options });

    expect(options.runUpdateProject).toHaveBeenCalledOnce();
  });

  it("does not check workspaces that did not come from a sable.json", async () => {
    const options = homeOptions({
      launchDirectory: undefined,
      runPicker: vi.fn().mockResolvedValueOnce({ type: "run", workspace }).mockResolvedValueOnce({ type: "exit" }),
    });

    await runWorkspaceHome({ store: createStore(config), ...options });

    expect(options.runUpdateProject).not.toHaveBeenCalled();
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
    items: [],
    itemIndexById: {},
    selectedItemIndex: undefined,
  };

  return {
    startAutoStartServices: vi.fn(async () => undefined),
    getState: vi.fn(() => state ?? defaultState),
    selectNextService: vi.fn(),
    selectPreviousService: vi.fn(),
    startSelectedService: vi.fn(async () => ({ status: "stopped" as const })),
    stopSelectedService: vi.fn(async () => ({ status: "stopped" as const })),
    restartSelectedService: vi.fn(async () => ({ status: "stopped" as const })),
    startItem: vi.fn(async () => ({ status: "stopped" as const })),
    startPlan: vi.fn(async () => undefined),
    startAll: vi.fn(() => "started" as const),
    isStarting: vi.fn(() => false),
    addItem: vi.fn(),
    updateItem: vi.fn(),
    removeItem: vi.fn(),
    moveService: vi.fn(),
    getSelectedServiceLogs: vi.fn(() => []),
    shutdown: vi.fn(async () => []),
  };
}

function createRuntimeStateForRestart(): RuntimeWorkspaceState {
  const runningState = { status: "running" as const };
  const stoppedState = { status: "stopped" as const };
  const items = [...servicesOf(restartWorkspace), ...commandsOf(restartWorkspace)].map((item) => ({
    item,
    process: item.id === "svc_web" || item.id === "cmd_build" ? stoppedState : runningState,
  }));

  return {
    workspace: { id: restartWorkspace.id, name: restartWorkspace.name },
    items,
    itemIndexById: Object.fromEntries(items.map((itemState, index) => [itemState.item.id, index])),
    selectedItemIndex: 0,
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
  items: [],
};

const workspaceWithService: WorkspaceConfig = {
  id: "ws_ecommerce",
  name: "ecommerce",
  projectDirectory: process.cwd(),
  items: [
    {
      kind: "service", after: [],
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
  items: [],
};

const config: AppConfig = {
  version: 2,
  workspaces: [workspace],
};

const configWithTwoWorkspaces: AppConfig = {
  version: 2,
  workspaces: [workspace, portfolioWorkspace],
};

const configWithService: AppConfig = {
  version: 2,
  workspaces: [workspaceWithService],
};

const restartWorkspace: WorkspaceConfig = {
  id: "ws_ecommerce",
  name: "ecommerce",
  projectDirectory: process.cwd(),
  items: [
    {
      kind: "service", after: [],
      id: "svc_api",
      name: "api",
      command: "npm run dev",
      cwd: process.cwd(),
      autoStart: true,
      env: {},
    },
    {
      kind: "service", after: [],
      id: "svc_worker",
      name: "worker",
      command: "npm run worker",
      cwd: process.cwd(),
      autoStart: false,
      env: {},
    },
    {
      kind: "service", after: [],
      id: "svc_web",
      name: "web",
      command: "npm run web",
      cwd: process.cwd(),
      autoStart: false,
      env: {},
    },
    {
      kind: "command", after: [],
      id: "cmd_watch",
      name: "watch",
      command: "npm run watch",
      cwd: process.cwd(),
      env: {},
    },
    {
      kind: "command", after: [],
      id: "cmd_build",
      name: "build",
      command: "npm run build",
      cwd: process.cwd(),
      env: {},
    },
  ],
};

const configForRestart: AppConfig = {
  version: 2,
  workspaces: [restartWorkspace],
};
