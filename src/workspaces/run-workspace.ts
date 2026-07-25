import type { AppConfig, WorkspaceConfig } from "../config/config-types.js";
import { WorkspaceController } from "../controller/workspace-controller.js";
import { TerminalKeyInput, type KeyInput } from "../input/terminal-key-input.js";
import {
  ProcessManager,
  type ManagedProcessState,
  type ServiceLogEntry,
} from "../process/process-manager.js";
import {
  runInteractiveDashboard,
  type InteractiveDashboardResult,
  type RunInteractiveDashboardOptions,
} from "../tui/interactive-dashboard.js";
import { requireWorkspaceByName } from "./find-workspace.js";

export type WorkspaceConfigReader = {
  load(): Promise<AppConfig>;
};

export type RunWorkspaceOutput = {
  log(message: string): void;
};

export type RunWorkspaceController = {
  startAutoStartServices(): Promise<void>;
  getState(): ReturnType<WorkspaceController["getState"]>;
  selectNextService(): ReturnType<WorkspaceController["selectNextService"]>;
  selectPreviousService(): ReturnType<WorkspaceController["selectPreviousService"]>;
  startSelectedService(): Promise<ManagedProcessState>;
  stopSelectedService(): Promise<ManagedProcessState>;
  restartSelectedService(): Promise<ManagedProcessState>;
  getSelectedServiceLogs(): ServiceLogEntry[];
  shutdown(): Promise<void>;
};

export type RunWorkspaceCommandOptions = {
  store: WorkspaceConfigReader;
  createController?: (workspace: WorkspaceConfig) => RunWorkspaceController;
  keyInput?: KeyInput;
  runDashboard?: (
    options: RunInteractiveDashboardOptions,
  ) => Promise<InteractiveDashboardResult>;
  signalSource?: RunWorkspaceSignalSource;
};

export type RunWorkspaceSignalSource = {
  once(signal: NodeJS.Signals, listener: () => void): void;
  off(signal: NodeJS.Signals, listener: () => void): void;
};

export type RunWorkspaceSessionOptions = {
  workspace: WorkspaceConfig;
  createController?: (workspace: WorkspaceConfig) => RunWorkspaceController;
  keyInput: KeyInput;
  runDashboard?: (
    options: RunInteractiveDashboardOptions,
  ) => Promise<InteractiveDashboardResult>;
  abortSignal?: AbortSignal;
  dashboardQuitLabel?: string;
};

export async function runWorkspaceCommand(
  rawWorkspaceName: string,
  options: RunWorkspaceCommandOptions,
): Promise<void> {
  const config = await options.store.load();
  const workspace = requireWorkspaceByName(config, rawWorkspaceName);
  const keyInput = options.keyInput ?? new TerminalKeyInput();
  const shutdownAbortController = new AbortController();
  const signalSource = options.signalSource ?? process;
  const abortShutdown = () => shutdownAbortController.abort();

  signalSource.once("SIGINT", abortShutdown);
  signalSource.once("SIGTERM", abortShutdown);

  try {
    await runWorkspaceSession({
      workspace,
      createController: options.createController,
      keyInput,
      runDashboard: options.runDashboard,
      abortSignal: shutdownAbortController.signal,
    });
  } finally {
    signalSource.off("SIGINT", abortShutdown);
    signalSource.off("SIGTERM", abortShutdown);
    keyInput.close();
  }
}

export async function runWorkspaceSession(
  options: RunWorkspaceSessionOptions,
): Promise<InteractiveDashboardResult> {
  const controller =
    options.createController?.(options.workspace) ??
    new WorkspaceController({
      workspace: options.workspace,
      processManager: new ProcessManager(),
    });
  const runDashboard = options.runDashboard ?? runInteractiveDashboard;

  try {
    await controller.startAutoStartServices();
    return await runDashboard({
      controller,
      keyInput: options.keyInput,
      abortSignal: options.abortSignal,
      dashboardQuitLabel: options.dashboardQuitLabel,
    });
  } finally {
    await controller.shutdown();
  }
}
