import type { AppConfig, WorkspaceConfig } from "../config/config-types.js";
import { TerminalKeyInput, type KeyInput } from "../input/terminal-key-input.js";
import {
  runWorkspacePicker,
  type RunWorkspacePickerOptions,
  type WorkspacePickerResult,
} from "../tui/workspace-picker.js";
import type { ShutdownFailure } from "../controller/workspace-controller.js";
import {
  createRunWorkspaceController,
  reportShutdownFailures,
  runWorkspaceSession,
  type RunWorkspaceController,
  type RunWorkspaceSessionOptions,
  type ShutdownWarn,
} from "./run-workspace.js";
import {
  runCreateWorkspaceFlow,
  type CreateWorkspaceFlowOptions,
  type CreateWorkspaceFlowResult,
} from "./create-workspace-flow.js";
import {
  runDeleteWorkspaceFlow,
  type DeleteWorkspaceFlowOptions,
  type DeleteWorkspaceFlowResult,
} from "./delete-workspace-flow.js";
import {
  runRenameWorkspaceFlow,
  type RenameWorkspaceFlowOptions,
  type RenameWorkspaceFlowResult,
} from "./rename-workspace-flow.js";
import { runUpdateDialog } from "../tui/update-dialog.js";
import { runSuggestServicesFlow, type SuggestServicesFlowOptions, type SuggestServicesFlowResult } from "./suggest-services-flow.js";

export type WorkspaceHomeConfigStore = {
  load(): Promise<AppConfig>;
  save(config: AppConfig): Promise<void>;
};

export type RunWorkspaceHomeOptions = {
  store: WorkspaceHomeConfigStore;
  keyInput?: KeyInput;
  runPicker?: (options: RunWorkspacePickerOptions) => Promise<WorkspacePickerResult>;
  runSession?: (options: RunWorkspaceSessionOptions) => Promise<{ type: "back" } | { type: "exit" }>;
  runCreateWorkspace?: (options: CreateWorkspaceFlowOptions) => Promise<CreateWorkspaceFlowResult>;
  runDeleteWorkspace?: (options: DeleteWorkspaceFlowOptions) => Promise<DeleteWorkspaceFlowResult>;
  runRenameWorkspace?: (options: RenameWorkspaceFlowOptions) => Promise<RenameWorkspaceFlowResult>;
  runSuggestServices?: (options: SuggestServicesFlowOptions) => Promise<SuggestServicesFlowResult>;
  update?: WorkspaceHomeUpdate;
  screen?: RunWorkspacePickerOptions["screen"];
  createController?: (workspace: WorkspaceConfig) => RunWorkspaceController;
  signalSource?: WorkspaceHomeSignalSource;
  warn?: ShutdownWarn;
};

export type WorkspaceHomeUpdate = {
  latestVersion(): string | undefined;
  currentVersion: string;
  installCommand: string;
  dismiss(version: string): Promise<void>;
  dialog?: typeof runUpdateDialog;
};

export type WorkspaceHomeResult = { type: "quit" } | { type: "update"; version: string };

export type WorkspaceHomeSignalSource = {
  once(signal: NodeJS.Signals, listener: () => void): void;
  off(signal: NodeJS.Signals, listener: () => void): void;
};

export async function runWorkspaceHome(
  options: RunWorkspaceHomeOptions,
): Promise<WorkspaceHomeResult> {
  const keyInput = options.keyInput ?? new TerminalKeyInput();
  const runPicker = options.runPicker ?? runWorkspacePicker;
  const runSession = options.runSession ?? runWorkspaceSession;
  const createWorkspace = options.runCreateWorkspace ?? runCreateWorkspaceFlow;
  const deleteWorkspace = options.runDeleteWorkspace ?? runDeleteWorkspaceFlow;
  const renameWorkspace = options.runRenameWorkspace ?? runRenameWorkspaceFlow;
  const suggestServices = options.runSuggestServices ?? runSuggestServicesFlow;
  const shutdownAbortController = new AbortController();
  const signalSource = options.signalSource ?? process;
  let statusMessage: string | undefined;
  let selectedWorkspaceId: string | undefined;
  let shouldShowStartupMoment = true;
  // Set after creating a workspace, so it opens directly instead of returning to the picker.
  let workspaceToOpen: { id: string; message: string } | undefined;
  let activeSession: { workspaceId: string; controller: RunWorkspaceController } | undefined;
  // Processes that failed to stop are reported once Sable leaves the TUI.
  const shutdownFailures: ShutdownFailure[] = [];
  const abortShutdown = () => shutdownAbortController.abort();
  const createController = options.createController ?? createRunWorkspaceController;

  signalSource.once("SIGINT", abortShutdown);
  signalSource.once("SIGTERM", abortShutdown);

  try {
    while (!shutdownAbortController.signal.aborted) {
      const config = await options.store.load();
      const opening = workspaceToOpen === undefined
        ? undefined
        : config.workspaces.find((workspace) => workspace.id === workspaceToOpen!.id);
      const openingMessage = workspaceToOpen?.message;

      workspaceToOpen = undefined;

      const pickerResult: WorkspacePickerResult = opening !== undefined ? { type: "run", workspace: opening } : await runPicker({
        workspaces: config.workspaces,
        keyInput,
        abortSignal: shutdownAbortController.signal,
        statusMessage,
        selectedWorkspaceId,
        activeWorkspaceId: activeSession?.workspaceId,
        activeRunningServiceCount: activeSession?.controller.getState().services
          .filter((serviceState) => serviceState.process.status === "running").length,
        startupMomentMs: shouldShowStartupMoment ? 700 : 0,
        afterStartup: options.update === undefined ? undefined : () => showUpdatePopup(options.update!, keyInput, options.screen),
        screen: options.screen,
      });

      shouldShowStartupMoment = false;

      if (pickerResult.type === "exit") {
        return { type: "quit" };
      }

      if (pickerResult.type === "update") {
        const version = options.update?.latestVersion();

        if (version !== undefined) {
          return { type: "update", version };
        }

        continue;
      }

      if (pickerResult.type === "createWorkspace") {
        let flowResult: CreateWorkspaceFlowResult;

        try {
          flowResult = await createWorkspace({
            store: options.store,
            keyInput,
            screen: options.screen,
          });
        } catch (error) {
          statusMessage = configUpdateFailedMessage(error);
          selectedWorkspaceId = undefined;
          continue;
        }

        if (flowResult.type === "exit") {
          return { type: "quit" };
        }

        statusMessage = flowResult.message;
        selectedWorkspaceId = flowResult.type === "completed" ? flowResult.workspaceId : undefined;

        if (flowResult.type === "completed") {
          let suggestion: SuggestServicesFlowResult;

          try {
            suggestion = await suggestServices({ store: options.store, workspaceId: flowResult.workspaceId, keyInput, screen: options.screen });
          } catch (error) {
            suggestion = { type: "skipped" };
            statusMessage = configUpdateFailedMessage(error);
          }

          if (suggestion.type === "exit") {
            return { type: "quit" };
          }

          workspaceToOpen = {
            id: flowResult.workspaceId,
            message: suggestion.type === "added" ? suggestion.message : `${flowResult.message} Press a to add a service.`,
          };
        }

        continue;
      }

      if (pickerResult.type === "deleteWorkspace") {
        if (activeSession?.workspaceId === pickerResult.workspace.id) {
          statusMessage = `Stop workspace "${pickerResult.workspace.name}" before deleting it.`;
          selectedWorkspaceId = pickerResult.workspace.id;
          continue;
        }

        let flowResult: DeleteWorkspaceFlowResult;

        try {
          flowResult = await deleteWorkspace({
            store: options.store,
            workspace: pickerResult.workspace,
            keyInput,
            screen: options.screen,
            background: pickerResult.background,
          });
        } catch (error) {
          statusMessage = configUpdateFailedMessage(error);
          selectedWorkspaceId = pickerResult.workspace.id;
          continue;
        }

        if (flowResult.type === "exit") {
          return { type: "quit" };
        }

        statusMessage = flowResult.message;
        selectedWorkspaceId = flowResult.type === "completed" ? flowResult.selectedWorkspaceId : undefined;

        continue;
      }

      if (pickerResult.type === "renameWorkspace") {
        let flowResult: RenameWorkspaceFlowResult;

        try {
          flowResult = await renameWorkspace({
            store: options.store,
            workspace: pickerResult.workspace,
            keyInput,
            screen: options.screen,
          });
        } catch (error) {
          statusMessage = configUpdateFailedMessage(error);
          selectedWorkspaceId = pickerResult.workspace.id;
          continue;
        }

        if (flowResult.type === "exit") {
          return { type: "quit" };
        }

        statusMessage = flowResult.message;
        selectedWorkspaceId = flowResult.type === "completed" ? flowResult.workspaceId : pickerResult.workspace.id;

        continue;
      }

      if (pickerResult.type === "reorderWorkspace") {
        try {
          const result = await reorderWorkspace({
            store: options.store,
            workspace: pickerResult.workspace,
            index: pickerResult.index,
          });

          statusMessage = result.message;
        } catch (error) {
          statusMessage = configUpdateFailedMessage(error);
        }

        selectedWorkspaceId = pickerResult.workspace.id;

        continue;
      }

      if (pickerResult.type === "stopActiveWorkspace") {
        if (activeSession === undefined) {
          statusMessage = "No workspace is running.";
        } else if (activeSession.workspaceId !== pickerResult.workspace.id) {
          statusMessage = "Select the running workspace to stop it.";
        } else {
          const failures = await activeSession.controller.shutdown();

          shutdownFailures.push(...failures);
          activeSession = undefined;
          statusMessage = `Stopped workspace "${pickerResult.workspace.name}".${formatLingeringProcesses(failures)}`;
        }

        selectedWorkspaceId = pickerResult.workspace.id;
        continue;
      }

      if (pickerResult.type === "restartActiveWorkspace") {
        if (activeSession === undefined) {
          statusMessage = "No workspace is running.";
        } else if (activeSession.workspaceId !== pickerResult.workspace.id) {
          statusMessage = "Select the running workspace to restart it.";
        } else {
          const restarted = await restartActiveSession({
            workspace: pickerResult.workspace,
            controller: activeSession.controller,
            createController,
          });

          shutdownFailures.push(...restarted.failures);
          activeSession = restarted.session;
          statusMessage = `Restarted workspace "${pickerResult.workspace.name}".${formatLingeringProcesses(restarted.failures)}`;
        }

        selectedWorkspaceId = pickerResult.workspace.id;
        continue;
      }

      let shouldStartAutoStartServices = false;

      if (activeSession !== undefined && activeSession.workspaceId !== pickerResult.workspace.id) {
        shutdownFailures.push(...await activeSession.controller.shutdown());
        activeSession = undefined;
      }

      if (activeSession === undefined) {
        activeSession = {
          workspaceId: pickerResult.workspace.id,
          controller: createController(pickerResult.workspace),
        };
        shouldStartAutoStartServices = true;
      }

      const sessionResult = await runSession({
        workspace: pickerResult.workspace,
        controller: activeSession.controller,
        keyInput,
        abortSignal: shutdownAbortController.signal,
        dashboardQuitLabel: "back",
        store: options.store,
        startAutoStartServices: shouldStartAutoStartServices,
        shutdownOnReturn: false,
        initialMessage: openingMessage,
      });

      statusMessage = undefined;
      selectedWorkspaceId = pickerResult.workspace.id;

      if (sessionResult.type === "exit") {
        return { type: "quit" };
      }
    }

    return { type: "quit" };
  } finally {
    if (activeSession !== undefined) {
      shutdownFailures.push(...await activeSession.controller.shutdown());
    }

    signalSource.off("SIGINT", abortShutdown);
    signalSource.off("SIGTERM", abortShutdown);
    keyInput.close();
    reportShutdownFailures(shutdownFailures, options.warn);
  }
}

function formatLingeringProcesses(failures: ShutdownFailure[]): string {
  if (failures.length === 0) {
    return "";
  }

  return ` Still running: ${failures.map((failure) => failure.name).join(", ")}.`;
}

async function showUpdatePopup(
  update: WorkspaceHomeUpdate,
  keyInput: KeyInput,
  screen: RunWorkspaceHomeOptions["screen"],
): Promise<"continue" | "update" | "exit"> {
  const version = update.latestVersion();

  if (version === undefined) {
    return "continue";
  }

  const choice = await (update.dialog ?? runUpdateDialog)({
    latestVersion: version,
    currentVersion: update.currentVersion,
    installCommand: update.installCommand,
    keyInput,
    screen,
  });

  if (choice === "ok") {
    await update.dismiss(version);
    return "continue";
  }

  return choice;
}

function configUpdateFailedMessage(error: unknown): string {
  return `Could not update config: ${error instanceof Error ? error.message : String(error)}`;
}

type RestartActiveSessionOptions = {
  workspace: WorkspaceConfig;
  controller: RunWorkspaceController;
  createController: (workspace: WorkspaceConfig) => RunWorkspaceController;
};

async function restartActiveSession(
  options: RestartActiveSessionOptions,
): Promise<{
  session: { workspaceId: string; controller: RunWorkspaceController };
  failures: ShutdownFailure[];
}> {
  const state = options.controller.getState();
  const runningServiceIds = new Set(
    state.services
      .filter((serviceState) => serviceState.process.status === "running")
      .map((serviceState) => serviceState.service.id),
  );

  for (const service of options.workspace.services) {
    if (service.autoStart) {
      runningServiceIds.add(service.id);
    }
  }

  // One-shot commands are not re-run: repeating something like a migration
  // is rarely what a restart should do.
  const failures = await options.controller.shutdown();
  const controller = options.createController(options.workspace);

  await Promise.all([...runningServiceIds].map((serviceId) => controller.startService(serviceId)));

  return { session: { workspaceId: options.workspace.id, controller }, failures };
}


type ReorderWorkspaceOptions = {
  store: WorkspaceHomeConfigStore;
  workspace: WorkspaceConfig;
  index: number;
};

async function reorderWorkspace(options: ReorderWorkspaceOptions): Promise<{ message: string }> {
  const config = await options.store.load();
  const workspaceIndex = config.workspaces.findIndex((workspace) => workspace.id === options.workspace.id);

  if (workspaceIndex < 0) {
    return { message: `Workspace "${options.workspace.name}" was not found.` };
  }

  const targetIndex = Math.min(Math.max(options.index, 0), config.workspaces.length - 1);
  const nextWorkspaces = [...config.workspaces];
  const [workspace] = nextWorkspaces.splice(workspaceIndex, 1);

  nextWorkspaces.splice(targetIndex, 0, workspace!);

  await options.store.save({
    ...config,
    workspaces: nextWorkspaces,
  });

  return { message: `Moved workspace "${workspace!.name}".` };
}
