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
  runAddServiceToWorkspaceCommand,
  type AddServicePrompts,
} from "./add-service.js";

export type WorkspaceHomeConfigStore = {
  load(): Promise<AppConfig>;
  save(config: AppConfig): Promise<void>;
};

export type RunWorkspaceHomeOptions = {
  store: WorkspaceHomeConfigStore;
  keyInput?: KeyInput;
  runPicker?: (options: RunWorkspacePickerOptions) => Promise<WorkspacePickerResult>;
  runSession?: (options: RunWorkspaceSessionOptions) => Promise<{ type: "back" } | { type: "exit" }>;
  addService?: (workspace: WorkspaceConfig) => Promise<void>;
  prompts?: AddServicePrompts;
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
  let keyInput = options.keyInput ?? new TerminalKeyInput();
  const runPicker = options.runPicker ?? runWorkspacePicker;
  const runSession = options.runSession ?? runWorkspaceSession;
  const shutdownAbortController = new AbortController();
  const signalSource = options.signalSource ?? process;
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
      });

      if (pickerResult.type === "exit") {
        return;
      }

      if (pickerResult.type === "addService") {
        await runPromptFlow(options, keyInput, async () => {
          await addServiceToWorkspace(options, pickerResult.workspace);
        });

        if (options.keyInput === undefined) {
          keyInput = new TerminalKeyInput();
        }

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

async function runPromptFlow(
  options: RunWorkspaceHomeOptions,
  keyInput: KeyInput,
  action: () => Promise<void>,
): Promise<void> {
  if (options.keyInput === undefined) {
    keyInput.close();
  }

  await action();
}

async function addServiceToWorkspace(
  options: RunWorkspaceHomeOptions,
  workspace: WorkspaceConfig,
): Promise<void> {
  if (options.addService !== undefined) {
    await options.addService(workspace);
    return;
  }

  if (options.prompts === undefined) {
    throw new Error("Add service prompts are required.");
  }

  await runAddServiceToWorkspaceCommand(workspace.id, {
    store: options.store,
    prompts: options.prompts,
  });
}
