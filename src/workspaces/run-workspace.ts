import type { AppConfig, WorkspaceConfig } from "../config/config-types.js";
import { WorkspaceController } from "../controller/workspace-controller.js";
import { ProcessManager } from "../process/process-manager.js";
import { renderStaticDashboard } from "../tui/static-dashboard.js";
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
  shutdown(): Promise<void>;
};

export type RunWorkspaceCommandOptions = {
  store: WorkspaceConfigReader;
  output?: RunWorkspaceOutput;
  createController?: (workspace: WorkspaceConfig) => RunWorkspaceController;
  render?: typeof renderStaticDashboard;
};

export async function runWorkspaceCommand(
  rawWorkspaceName: string,
  options: RunWorkspaceCommandOptions,
): Promise<void> {
  const output = options.output ?? console;
  const render = options.render ?? renderStaticDashboard;
  const config = await options.store.load();
  const workspace = requireWorkspaceByName(config, rawWorkspaceName);
  const controller =
    options.createController?.(workspace) ??
    new WorkspaceController({
      workspace,
      processManager: new ProcessManager(),
    });

  try {
    await controller.startAutoStartServices();
    output.log(render(controller.getState()));
  } finally {
    await controller.shutdown();
  }
}
