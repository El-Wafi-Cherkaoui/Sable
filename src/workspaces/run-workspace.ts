import type { AppConfig, WorkspaceConfig } from "../config/config-types.js";
import { WorkspaceController } from "../controller/workspace-controller.js";
import { TerminalKeyInput, type KeyInput } from "../input/terminal-key-input.js";
import { ProcessManager, type ManagedProcessState } from "../process/process-manager.js";
import {
  runInteractiveDashboard,
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
  shutdown(): Promise<void>;
};

export type RunWorkspaceCommandOptions = {
  store: WorkspaceConfigReader;
  createController?: (workspace: WorkspaceConfig) => RunWorkspaceController;
  keyInput?: KeyInput;
  runDashboard?: (options: RunInteractiveDashboardOptions) => Promise<void>;
};

export async function runWorkspaceCommand(
  rawWorkspaceName: string,
  options: RunWorkspaceCommandOptions,
): Promise<void> {
  const config = await options.store.load();
  const workspace = requireWorkspaceByName(config, rawWorkspaceName);
  const controller =
    options.createController?.(workspace) ??
    new WorkspaceController({
      workspace,
      processManager: new ProcessManager(),
    });
  const keyInput = options.keyInput ?? new TerminalKeyInput();
  const runDashboard = options.runDashboard ?? runInteractiveDashboard;

  try {
    await controller.startAutoStartServices();
    await runDashboard({ controller, keyInput });
  } finally {
    keyInput.close();
    await controller.shutdown();
  }
}
