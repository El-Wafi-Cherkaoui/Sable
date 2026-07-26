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
