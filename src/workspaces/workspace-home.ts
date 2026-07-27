import type { AppConfig, WorkspaceConfig } from "../config/config-types.js";
import { TerminalKeyInput, type KeyInput } from "../input/terminal-key-input.js";
import {
  runWorkspacePicker,
  type RunWorkspacePickerOptions,
  type WorkspacePickerResult,
} from "../tui/workspace-picker.js";
import {
  runWorkspaceSession,
  type RunWorkspaceController,
  type RunWorkspaceSessionOptions,
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
  screen?: RunWorkspacePickerOptions["screen"];
  createController?: (workspace: WorkspaceConfig) => RunWorkspaceController;
  signalSource?: WorkspaceHomeSignalSource;
};

export type WorkspaceHomeSignalSource = {
  once(signal: NodeJS.Signals, listener: () => void): void;
  off(signal: NodeJS.Signals, listener: () => void): void;
};

export async function runWorkspaceHome(
  options: RunWorkspaceHomeOptions,
): Promise<void> {
  const keyInput = options.keyInput ?? new TerminalKeyInput();
  const runPicker = options.runPicker ?? runWorkspacePicker;
  const runSession = options.runSession ?? runWorkspaceSession;
  const createWorkspace = options.runCreateWorkspace ?? runCreateWorkspaceFlow;
  const deleteWorkspace = options.runDeleteWorkspace ?? runDeleteWorkspaceFlow;
  const renameWorkspace = options.runRenameWorkspace ?? runRenameWorkspaceFlow;
  const shutdownAbortController = new AbortController();
  const signalSource = options.signalSource ?? process;
  let statusMessage: string | undefined;
  let selectedWorkspaceId: string | undefined;
  const abortShutdown = () => shutdownAbortController.abort();

  signalSource.once("SIGINT", abortShutdown);
  signalSource.once("SIGTERM", abortShutdown);

  try {
    while (!shutdownAbortController.signal.aborted) {
      const config = await options.store.load();
      const pickerResult = await runPicker({
        workspaces: config.workspaces,
        keyInput,
        abortSignal: shutdownAbortController.signal,
        statusMessage,
        selectedWorkspaceId,
        screen: options.screen,
      });

      if (pickerResult.type === "exit") {
        return;
      }

      if (pickerResult.type === "createWorkspace") {
        const flowResult = await createWorkspace({
          store: options.store,
          keyInput,
          screen: options.screen,
        });

        if (flowResult.type === "exit") {
          return;
        }

        statusMessage = flowResult.message;
        selectedWorkspaceId = flowResult.type === "completed" ? flowResult.workspaceId : undefined;

        continue;
      }

      if (pickerResult.type === "deleteWorkspace") {
        const flowResult = await deleteWorkspace({
          store: options.store,
          workspace: pickerResult.workspace,
          keyInput,
          screen: options.screen,
        });

        if (flowResult.type === "exit") {
          return;
        }

        statusMessage = flowResult.message;
        selectedWorkspaceId = flowResult.type === "completed" ? flowResult.selectedWorkspaceId : undefined;

        continue;
      }

      if (pickerResult.type === "renameWorkspace") {
        const flowResult = await renameWorkspace({
          store: options.store,
          workspace: pickerResult.workspace,
          keyInput,
          screen: options.screen,
        });

        if (flowResult.type === "exit") {
          return;
        }

        statusMessage = flowResult.message;
        selectedWorkspaceId = flowResult.type === "completed" ? flowResult.workspaceId : pickerResult.workspace.id;

        continue;
      }

      if (pickerResult.type === "moveWorkspaceUp" || pickerResult.type === "moveWorkspaceDown") {
        const result = await moveWorkspace({
          store: options.store,
          workspace: pickerResult.workspace,
          direction: pickerResult.type === "moveWorkspaceUp" ? "up" : "down",
        });

        statusMessage = result.message;
        selectedWorkspaceId = pickerResult.workspace.id;

        continue;
      }

      const sessionResult = await runSession({
        workspace: pickerResult.workspace,
        createController: options.createController,
        keyInput,
        abortSignal: shutdownAbortController.signal,
        dashboardQuitLabel: "back",
        store: options.store,
      });

      if (sessionResult.type === "exit") {
        return;
      }
    }
  } finally {
    signalSource.off("SIGINT", abortShutdown);
    signalSource.off("SIGTERM", abortShutdown);
    keyInput.close();
  }
}


type MoveWorkspaceOptions = {
  store: WorkspaceHomeConfigStore;
  workspace: WorkspaceConfig;
  direction: "up" | "down";
};

async function moveWorkspace(options: MoveWorkspaceOptions): Promise<{ message: string }> {
  const config = await options.store.load();
  const workspaceIndex = config.workspaces.findIndex((workspace) => workspace.id === options.workspace.id);

  if (workspaceIndex < 0) {
    return { message: `Workspace "${options.workspace.name}" was not found.` };
  }

  const targetIndex = options.direction === "up" ? workspaceIndex - 1 : workspaceIndex + 1;

  if (targetIndex < 0) {
    return { message: `Workspace "${options.workspace.name}" is already first.` };
  }

  if (targetIndex >= config.workspaces.length) {
    return { message: `Workspace "${options.workspace.name}" is already last.` };
  }

  const nextWorkspaces = [...config.workspaces];
  const [workspace] = nextWorkspaces.splice(workspaceIndex, 1);

  if (workspace === undefined) {
    return { message: `Workspace "${options.workspace.name}" was not found.` };
  }

  nextWorkspaces.splice(targetIndex, 0, workspace);

  await options.store.save({
    ...config,
    workspaces: nextWorkspaces,
  });

  return { message: `Moved workspace "${workspace.name}" ${options.direction}.` };
}
