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
  runAddServiceFlow,
  runEditServiceFlow,
  type ServiceFlowOptions,
  type ServiceFlowResult,
} from "./service-flows.js";

export type WorkspaceHomeConfigStore = {
  load(): Promise<AppConfig>;
  save(config: AppConfig): Promise<void>;
};

export type RunWorkspaceHomeOptions = {
  store: WorkspaceHomeConfigStore;
  keyInput?: KeyInput;
  runPicker?: (options: RunWorkspacePickerOptions) => Promise<WorkspacePickerResult>;
  runSession?: (options: RunWorkspaceSessionOptions) => Promise<{ type: "back" } | { type: "exit" }>;
  runAddService?: (options: ServiceFlowOptions) => Promise<ServiceFlowResult>;
  runEditService?: (options: ServiceFlowOptions) => Promise<ServiceFlowResult>;
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
  const addService = options.runAddService ?? runAddServiceFlow;
  const editService = options.runEditService ?? runEditServiceFlow;
  const shutdownAbortController = new AbortController();
  const signalSource = options.signalSource ?? process;
  let statusMessage: string | undefined;
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
        screen: options.screen,
      });

      if (pickerResult.type === "exit") {
        return;
      }

      if (pickerResult.type === "addService") {
        const flowResult = await addService({
          store: options.store,
          workspace: pickerResult.workspace,
          keyInput,
          screen: options.screen,
        });

        if (flowResult.type === "exit") {
          return;
        }

        statusMessage = flowResult.message;

        continue;
      }

      if (pickerResult.type === "editService") {
        const flowResult = await editService({
          store: options.store,
          workspace: pickerResult.workspace,
          keyInput,
          screen: options.screen,
        });

        if (flowResult.type === "exit") {
          return;
        }

        statusMessage = flowResult.message;

        continue;
      }

      const sessionResult = await runSession({
        workspace: pickerResult.workspace,
        createController: options.createController,
        keyInput,
        abortSignal: shutdownAbortController.signal,
        dashboardQuitLabel: "back",
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
