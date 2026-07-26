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
import { runAddServiceFlow, runEditServiceFlow } from "./service-flows.js";

export type WorkspaceConfigReader = {
  load(): Promise<AppConfig>;
  save(config: AppConfig): Promise<void>;
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
  startService(serviceId: string): Promise<ManagedProcessState>;
  addService(service: WorkspaceConfig["services"][number]): ReturnType<WorkspaceController["addService"]>;
  updateService(service: WorkspaceConfig["services"][number]): ReturnType<WorkspaceController["updateService"]>;
  removeService(serviceId: string): ReturnType<WorkspaceController["removeService"]>;
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
  store?: WorkspaceConfigReader;
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
      store: options.store,
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
      onAddService: options.store === undefined
        ? undefined
        : async () => {
          const flowResult = await runAddServiceFlow({
            store: options.store!,
            workspace: options.workspace,
            keyInput: options.keyInput,
          });

          if (flowResult.type === "exit") {
            return { type: "exit" };
          }

          if (flowResult.type === "completed" && flowResult.serviceId !== undefined) {
            const config = await options.store!.load();
            const workspace = config.workspaces.find((candidate) => candidate.id === options.workspace.id);
            const service = workspace?.services.find((candidate) => candidate.id === flowResult.serviceId);

            if (service !== undefined) {
              controller.addService(service);

              if (service.autoStart) {
                await controller.startService(service.id);
              }
            }
          }

          return { type: "continue", message: flowResult.type === "completed" ? flowResult.message : flowResult.message };
        },
      onEditService: options.store === undefined
        ? undefined
        : async () => {
          const selectedServiceState = getSelectedServiceState(controller.getState());

          if (selectedServiceState === undefined) {
            return { type: "continue", message: "Add a service first." };
          }

          if (selectedServiceState.process.status === "running") {
            return { type: "continue", message: "Stop service before editing." };
          }

          const flowResult = await runEditServiceFlow({
            store: options.store!,
            workspace: options.workspace,
            keyInput: options.keyInput,
            serviceId: selectedServiceState.service.id,
          });

          if (flowResult.type === "exit") {
            return { type: "exit" };
          }

          if (flowResult.type === "completed") {
            if (flowResult.removedServiceId !== undefined) {
              controller.removeService(flowResult.removedServiceId);
            } else if (flowResult.serviceId !== undefined) {
              const config = await options.store!.load();
              const workspace = config.workspaces.find((candidate) => candidate.id === options.workspace.id);
              const service = workspace?.services.find((candidate) => candidate.id === flowResult.serviceId);

              if (service !== undefined) {
                controller.updateService(service);
              }
            }
          }

          return { type: "continue", message: flowResult.message };
        },
    });
  } finally {
    await controller.shutdown();
  }
}

function getSelectedServiceState(state: ReturnType<RunWorkspaceController["getState"]>) {
  if (state.selectedServiceIndex === undefined) {
    return undefined;
  }

  return state.services[state.selectedServiceIndex];
}
