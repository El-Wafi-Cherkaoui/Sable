import type { AppConfig, WorkspaceConfig } from "../config/config-types.js";
import {
  formatShutdownFailure,
  WorkspaceController,
  type ShutdownFailure,
} from "../controller/workspace-controller.js";
import { TerminalKeyInput, type KeyInput } from "../input/terminal-key-input.js";
import {
  ProcessManager,
  type ManagedProcessState,
  type ServiceLogEntry,
} from "../process/process-manager.js";
import {
  runInteractiveDashboard,
  type DashboardCallbackResult,
  type InteractiveDashboardResult,
  type RunInteractiveDashboardOptions,
} from "../tui/interactive-dashboard.js";
import type { SettingsControl } from "../settings/settings-control.js";
import type { SoundControl } from "../sound/sound-control.js";
import type { PromptScreen } from "../tui/prompt-view.js";
import { requireWorkspaceByName } from "./find-workspace.js";
import { runAddWorkspaceItemFlow, runDeleteCommandFlow, runDeleteServiceFlow, runEditCommandFlow, runEditServiceFlow } from "./service-flows.js";

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
  startCommand(commandId: string): Promise<ManagedProcessState>;
  addService(service: WorkspaceConfig["services"][number]): ReturnType<WorkspaceController["addService"]>;
  addCommand(command: WorkspaceConfig["commands"][number]): ReturnType<WorkspaceController["addCommand"]>;
  updateService(service: WorkspaceConfig["services"][number]): ReturnType<WorkspaceController["updateService"]>;
  updateCommand(command: WorkspaceConfig["commands"][number]): ReturnType<WorkspaceController["updateCommand"]>;
  removeService(serviceId: string): ReturnType<WorkspaceController["removeService"]>;
  removeCommand(commandId: string): ReturnType<WorkspaceController["removeCommand"]>;
  moveService(serviceId: string, direction: "up" | "down"): ReturnType<WorkspaceController["moveService"]>;
  getSelectedServiceLogs(): ServiceLogEntry[];
  shutdown(): Promise<ShutdownFailure[]>;
};

export type ShutdownWarn = (message: string) => void;

export type RunWorkspaceCommandOptions = {
  store: WorkspaceConfigReader;
  createController?: (workspace: WorkspaceConfig) => RunWorkspaceController;
  keyInput?: KeyInput;
  sound?: SoundControl;
  settings?: SettingsControl;
  runDashboard?: (
    options: RunInteractiveDashboardOptions,
  ) => Promise<InteractiveDashboardResult>;
  signalSource?: RunWorkspaceSignalSource;
  warn?: ShutdownWarn;
};

// Closing the terminal sends SIGHUP; handling it stops the services instead of leaving them behind.
export const shutdownSignals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

export type RunWorkspaceSignalSource = {
  once(signal: NodeJS.Signals, listener: () => void): void;
  off(signal: NodeJS.Signals, listener: () => void): void;
};

export type RunWorkspaceSessionOptions = {
  workspace: WorkspaceConfig;
  controller?: RunWorkspaceController;
  createController?: (workspace: WorkspaceConfig) => RunWorkspaceController;
  keyInput: KeyInput;
  sound?: SoundControl;
  settings?: SettingsControl;
  runDashboard?: (
    options: RunInteractiveDashboardOptions,
  ) => Promise<InteractiveDashboardResult>;
  abortSignal?: AbortSignal;
  dashboardQuitLabel?: string;
  store?: WorkspaceConfigReader;
  promptScreen?: PromptScreen;
  startAutoStartServices?: boolean;
  shutdownOnReturn?: boolean;
  initialMessage?: string;
  warn?: ShutdownWarn;
};

export function createRunWorkspaceController(
  workspace: WorkspaceConfig,
  options: { sound?: SoundControl } = {},
): RunWorkspaceController {
  return new WorkspaceController({
    workspace,
    // A process that ends on its own gets a chime; one Sable stops does not.
    processManager: new ProcessManager({ onAttention: () => options.sound?.play("attention") }),
  });
}

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

  for (const signal of shutdownSignals) {
    signalSource.once(signal, abortShutdown);
  }

  try {
    await runWorkspaceSession({
      workspace,
      createController: options.createController,
      sound: options.sound,
      settings: options.settings,
      keyInput,
      runDashboard: options.runDashboard,
      abortSignal: shutdownAbortController.signal,
      store: options.store,
      warn: options.warn,
    });
  } finally {
    for (const signal of shutdownSignals) {
      signalSource.off(signal, abortShutdown);
    }
    keyInput.close();
  }
}

export async function runWorkspaceSession(
  options: RunWorkspaceSessionOptions,
): Promise<InteractiveDashboardResult> {
  const controller =
    options.controller ??
    options.createController?.(options.workspace) ??
    createRunWorkspaceController(options.workspace, { sound: options.sound });
  const runDashboard = options.runDashboard ?? runInteractiveDashboard;
  const shouldStartAutoStartServices = options.startAutoStartServices ?? true;
  const shouldShutdownOnReturn = options.shutdownOnReturn ?? true;

  try {
    if (shouldStartAutoStartServices) {
      await controller.startAutoStartServices();
    }

    return await runDashboard({
      controller,
      keyInput: options.keyInput,
      sound: options.sound,
      settings: options.settings,
      abortSignal: options.abortSignal,
      dashboardQuitLabel: options.dashboardQuitLabel,
      initialMessage: options.initialMessage,
      onAddService: options.store === undefined
        ? undefined
        : guardConfigUpdate(async () => {
          const flowResult = await runAddWorkspaceItemFlow({
            store: options.store!,
            workspace: options.workspace,
            keyInput: options.keyInput,
            screen: options.promptScreen,
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

          if (flowResult.type === "completed" && flowResult.commandId !== undefined) {
            const config = await options.store!.load();
            const workspace = config.workspaces.find((candidate) => candidate.id === options.workspace.id);
            const command = workspace?.commands.find((candidate) => candidate.id === flowResult.commandId);

            if (command !== undefined) {
              controller.addCommand(command);
            }
          }

          return { type: "continue", message: flowResult.type === "completed" ? flowResult.message : flowResult.message };
        }),
      onEditService: options.store === undefined
        ? undefined
        : guardConfigUpdate(async () => {
          const state = controller.getState();
          const selectedServiceState = getSelectedServiceState(state);
          const selectedCommandState = getSelectedCommandState(state);

          if (selectedServiceState === undefined && selectedCommandState === undefined) {
            return { type: "continue", message: "Add a service or command first." };
          }

          if (selectedCommandState !== undefined) {
            const flowResult = await runEditCommandFlow({
              store: options.store!,
              workspace: options.workspace,
              keyInput: options.keyInput,
              commandId: selectedCommandState.command.id,
              screen: options.promptScreen,
            });

            if (flowResult.type === "exit") {
              return { type: "exit" };
            }

            if (flowResult.type === "completed" && flowResult.commandId !== undefined) {
              const config = await options.store!.load();
              const workspace = config.workspaces.find((candidate) => candidate.id === options.workspace.id);
              const command = workspace?.commands.find((candidate) => candidate.id === flowResult.commandId);

              if (command !== undefined) {
                controller.updateCommand(command);
              }

              if (selectedCommandState.process.status === "running") {
                return { type: "continue", message: `${flowResult.message} The change applies next time it runs.` };
              }
            }

            return { type: "continue", message: flowResult.message };
          }

          const flowResult = await runEditServiceFlow({
            store: options.store!,
            workspace: options.workspace,
            keyInput: options.keyInput,
            serviceId: selectedServiceState!.service.id,
            screen: options.promptScreen,
          });

          if (flowResult.type === "exit") {
            return { type: "exit" };
          }

          if (flowResult.type === "completed" && flowResult.serviceId !== undefined) {
            const config = await options.store!.load();
            const workspace = config.workspaces.find((candidate) => candidate.id === options.workspace.id);
            const service = workspace?.services.find((candidate) => candidate.id === flowResult.serviceId);

            if (service !== undefined) {
              controller.updateService(service);
            }

            // Editing a running service is allowed; the new settings take effect on restart.
            if (selectedServiceState!.process.status === "running") {
              return { type: "continue", message: `${flowResult.message} Press r to restart it with the changes.` };
            }
          }

          return { type: "continue", message: flowResult.message };
        }),
      onDeleteService: options.store === undefined
        ? undefined
        : guardConfigUpdate(async (context?: { background?: string }) => {
          const state = controller.getState();
          const selectedServiceState = getSelectedServiceState(state);
          const selectedCommandState = getSelectedCommandState(state);

          if (selectedServiceState === undefined && selectedCommandState === undefined) {
            return { type: "continue", message: "Add a service or command first." };
          }

          if (selectedCommandState !== undefined) {
            if (selectedCommandState.process.status === "running") {
              return { type: "continue", message: "Stop command before deleting." };
            }

            const flowResult = await runDeleteCommandFlow({
              store: options.store!,
              workspace: options.workspace,
              keyInput: options.keyInput,
              commandId: selectedCommandState.command.id,
              screen: options.promptScreen,
              background: context?.background,
            });

            if (flowResult.type === "exit") {
              return { type: "exit" };
            }

            if (flowResult.type === "completed" && flowResult.removedCommandId !== undefined) {
              controller.removeCommand(flowResult.removedCommandId);
            }

            return { type: "continue", message: flowResult.message };
          }

          if (selectedServiceState!.process.status === "running") {
            return { type: "continue", message: "Stop service before deleting." };
          }

          const flowResult = await runDeleteServiceFlow({
            store: options.store!,
            workspace: options.workspace,
            keyInput: options.keyInput,
            serviceId: selectedServiceState!.service.id,
            screen: options.promptScreen,
            background: context?.background,
          });

          if (flowResult.type === "exit") {
            return { type: "exit" };
          }

          if (flowResult.type === "completed" && flowResult.removedServiceId !== undefined) {
            controller.removeService(flowResult.removedServiceId);
          }

          return { type: "continue", message: flowResult.message };
        }),
      onMoveServiceUp: options.store === undefined
        ? undefined
        : guardConfigUpdate(async () => moveSelectedService({
          store: options.store!,
          workspace: options.workspace,
          controller,
          direction: "up",
        })),
      onMoveServiceDown: options.store === undefined
        ? undefined
        : guardConfigUpdate(async () => moveSelectedService({
          store: options.store!,
          workspace: options.workspace,
          controller,
          direction: "down",
        })),
    });
  } finally {
    if (shouldShutdownOnReturn) {
      reportShutdownFailures(await controller.shutdown(), options.warn);
    }
  }
}

export function reportShutdownFailures(
  failures: ShutdownFailure[],
  warn: ShutdownWarn = (message) => console.error(message),
): void {
  for (const failure of failures) {
    warn(`warning: ${formatShutdownFailure(failure)}`);
  }
}

function guardConfigUpdate<Args extends unknown[]>(
  callback: (...args: Args) => Promise<DashboardCallbackResult>,
): (...args: Args) => Promise<DashboardCallbackResult> {
  return async (...args: Args) => {
    try {
      return await callback(...args);
    } catch (error) {
      return {
        type: "continue",
        message: `Could not update config: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  };
}

function getSelectedServiceState(state: ReturnType<RunWorkspaceController["getState"]>) {
  if (state.selectedServiceIndex === undefined) {
    return undefined;
  }

  return state.services[state.selectedServiceIndex];
}

function getSelectedCommandState(state: ReturnType<RunWorkspaceController["getState"]>) {
  if (state.selectedCommandIndex === undefined) {
    return undefined;
  }

  return state.commands[state.selectedCommandIndex];
}


type MoveSelectedServiceOptions = {
  store: WorkspaceConfigReader;
  workspace: WorkspaceConfig;
  controller: RunWorkspaceController;
  direction: "up" | "down";
};

async function moveSelectedService(
  options: MoveSelectedServiceOptions,
): Promise<{ type: "continue"; message: string }> {
  const selectedServiceState = getSelectedServiceState(options.controller.getState());

  if (selectedServiceState === undefined) {
    return { type: "continue", message: "Add a service first." };
  }

  const config = await options.store.load();
  const workspace = config.workspaces.find((candidate) => candidate.id === options.workspace.id);

  if (workspace === undefined) {
    return { type: "continue", message: `Workspace "${options.workspace.name}" was not found.` };
  }

  const serviceIndex = workspace.services.findIndex((service) => service.id === selectedServiceState.service.id);

  if (serviceIndex < 0) {
    return { type: "continue", message: `Service "${selectedServiceState.service.name}" was not found.` };
  }

  const targetIndex = options.direction === "up" ? serviceIndex - 1 : serviceIndex + 1;

  if (targetIndex < 0) {
    return { type: "continue", message: `Service "${selectedServiceState.service.name}" is already first.` };
  }

  if (targetIndex >= workspace.services.length) {
    return { type: "continue", message: `Service "${selectedServiceState.service.name}" is already last.` };
  }

  const nextServices = [...workspace.services];
  const [service] = nextServices.splice(serviceIndex, 1);

  if (service === undefined) {
    return { type: "continue", message: `Service "${selectedServiceState.service.name}" was not found.` };
  }

  nextServices.splice(targetIndex, 0, service);

  await options.store.save({
    ...config,
    workspaces: config.workspaces.map((candidate) =>
      candidate.id === workspace.id ? { ...candidate, services: nextServices } : candidate,
    ),
  });

  options.controller.moveService(service.id, options.direction);

  return { type: "continue", message: `Moved service "${service.name}" ${options.direction}.` };
}
