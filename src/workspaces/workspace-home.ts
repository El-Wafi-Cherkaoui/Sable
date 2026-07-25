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
import {
  runEditServiceInWorkspaceCommand,
  type EditServicePrompts,
} from "./edit-service.js";

export type WorkspaceHomeConfigStore = {
  load(): Promise<AppConfig>;
  save(config: AppConfig): Promise<void>;
};

export type RunWorkspaceHomeOptions = {
  store: WorkspaceHomeConfigStore;
  keyInput?: KeyInput;
  runPicker?: (options: RunWorkspacePickerOptions) => Promise<WorkspacePickerResult>;
  runSession?: (options: RunWorkspaceSessionOptions) => Promise<{ type: "back" } | { type: "exit" }>;
  addService?: (workspace: WorkspaceConfig) => Promise<string | undefined>;
  editService?: (workspace: WorkspaceConfig) => Promise<string | undefined>;
  prompts?: AddServicePrompts & EditServicePrompts;
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
      });

      if (pickerResult.type === "exit") {
        return;
      }

      if (pickerResult.type === "addService") {
        statusMessage = await runPromptFlow(
          options,
          keyInput,
          "Add service cancelled.",
          async () => addServiceToWorkspace(options, pickerResult.workspace),
        );

        if (options.keyInput === undefined) {
          keyInput = new TerminalKeyInput();
        }

        continue;
      }

      if (pickerResult.type === "editService") {
        statusMessage = await runPromptFlow(
          options,
          keyInput,
          "Edit cancelled.",
          async () => editServiceInWorkspace(options, pickerResult.workspace),
        );

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
  cancelMessage: string,
  action: () => Promise<string | undefined>,
): Promise<string | undefined> {
  if (options.keyInput === undefined) {
    keyInput.close();
  }

  try {
    return await action();
  } catch (error) {
    if (isPromptCancelError(error)) {
      return cancelMessage;
    }

    throw error;
  }
}

async function addServiceToWorkspace(
  options: RunWorkspaceHomeOptions,
  workspace: WorkspaceConfig,
): Promise<string | undefined> {
  if (options.addService !== undefined) {
    return options.addService(workspace);
  }

  if (options.prompts === undefined) {
    throw new Error("Add service prompts are required.");
  }

  let message: string | undefined;

  await runAddServiceToWorkspaceCommand(workspace.id, {
    store: options.store,
    prompts: options.prompts,
    output: {
      log(value) {
        message = value;
      },
    },
  });

  return message;
}

function isPromptCancelError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.name === "ExitPromptError";
}

async function editServiceInWorkspace(
  options: RunWorkspaceHomeOptions,
  workspace: WorkspaceConfig,
): Promise<string | undefined> {
  if (options.editService !== undefined) {
    return options.editService(workspace);
  }

  if (options.prompts === undefined) {
    throw new Error("Edit service prompts are required.");
  }

  let message: string | undefined;

  await runEditServiceInWorkspaceCommand(workspace.id, {
    store: options.store,
    prompts: options.prompts,
    output: {
      log(value) {
        message = value;
      },
    },
  });

  return message;
}
