import type { AppConfig, ItemConfig, WorkspaceConfig } from "../config/config-types.js";
import { findItem, moveService, servicesOf } from "../config/workspace-items.js";
import { getSelectedItem, getSelectedService } from "../runtime/runtime-state.js";
import {
  formatShutdownFailure,
  WorkspaceController,
  type ShutdownFailure,
} from "../controller/workspace-controller.js";
import { TerminalKeyInput, type KeyInput } from "../input/terminal-key-input.js";
import type { LogFiles } from "../logs/log-files.js";
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
import { runWorkspaceSavedLogs } from "./saved-logs-flow.js";
import { runSecretsFlow } from "./secrets-flow.js";
import { runAddWorkspaceItemFlow, runDeleteItemFlow, runEditItemFlow } from "./service-flows.js";

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
  startItem(itemId: string): Promise<ManagedProcessState>;
  clearEarlierOutput(itemIds?: string[]): void;
  startPlan(itemIds: string[]): Promise<void>;
  startAll: WorkspaceController["startAll"];
  isStarting: WorkspaceController["isStarting"];
  addItem(item: ItemConfig): ReturnType<WorkspaceController["addItem"]>;
  updateItem(item: ItemConfig): ReturnType<WorkspaceController["updateItem"]>;
  removeItem(itemId: string): ReturnType<WorkspaceController["removeItem"]>;
  moveService(serviceId: string, direction: "up" | "down"): ReturnType<WorkspaceController["moveService"]>;
  getSelectedServiceLogs(): ServiceLogEntry[];
  shutdown(): Promise<ShutdownFailure[]>;
};

export type ShutdownWarn = (message: string) => void;

// How many saved lines from an earlier run are shown above a fresh run's output.
const earlierOutputLines = 300;

export type RunWorkspaceCommandOptions = {
  store: WorkspaceConfigReader;
  logFiles?: LogFiles;
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
  logFiles?: LogFiles;
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
  options: { sound?: SoundControl; logFiles?: LogFiles } = {},
): RunWorkspaceController {
  const { logFiles } = options;
  // The process manager is built first, but needs the controller to name the item a line belongs to.
  const created: { controller?: WorkspaceController } = {};
  const processManager = new ProcessManager({
    // A process that ends on its own gets a chime; one Sable stops does not.
    onAttention: () => options.sound?.play("attention"),
    onLog: logFiles === undefined
      ? undefined
      : (id, entries) => {
        const target = created.controller?.describeItem(id);

        if (target !== undefined) {
          for (const entry of entries) {
            logFiles.append(target, entry);
          }
        }
      },
  });

  created.controller = new WorkspaceController({
    workspace,
    processManager,
    earlierOutput: logFiles === undefined ? undefined : (target) => logFiles.readEarlier(target, earlierOutputLines),
  });

  return created.controller;
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
      logFiles: options.logFiles,
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
    createRunWorkspaceController(options.workspace, { sound: options.sound, logFiles: options.logFiles });
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

          if (flowResult.type === "completed" && flowResult.itemId !== undefined) {
            const item = await loadItem(options.store!, options.workspace.id, flowResult.itemId);

            if (item !== undefined) {
              controller.addItem(item);

              if (item.kind === "service" && item.autoStart) {
                await controller.startItem(item.id);
              }
            }
          }

          return { type: "continue", message: flowResult.message };
        }),
      onEditService: options.store === undefined
        ? undefined
        : guardConfigUpdate(async () => {
          const selected = getSelectedItem(controller.getState());

          if (selected === undefined) {
            return { type: "continue", message: "Add a service or command first." };
          }

          const flowResult = await runEditItemFlow({
            store: options.store!,
            workspace: options.workspace,
            keyInput: options.keyInput,
            itemId: selected.item.id,
            screen: options.promptScreen,
          });

          if (flowResult.type === "exit") {
            return { type: "exit" };
          }

          if (flowResult.type === "completed" && flowResult.itemId !== undefined) {
            const item = await loadItem(options.store!, options.workspace.id, flowResult.itemId);

            if (item !== undefined) {
              controller.updateItem(item);
            }

            // Editing a running item is allowed; the new settings take effect the next time it starts.
            if (selected.process.status === "running") {
              return {
                type: "continue",
                message: selected.item.kind === "service"
                  ? `${flowResult.message} Press r to restart it with the changes.`
                  : `${flowResult.message} The change applies next time it runs.`,
              };
            }
          }

          return { type: "continue", message: flowResult.message };
        }),
      onDeleteService: options.store === undefined
        ? undefined
        : guardConfigUpdate(async (context?: { background?: string }) => {
          const selected = getSelectedItem(controller.getState());

          if (selected === undefined) {
            return { type: "continue", message: "Add a service or command first." };
          }

          if (selected.process.status === "running") {
            return { type: "continue", message: `Stop ${selected.item.kind} before deleting.` };
          }

          const flowResult = await runDeleteItemFlow({
            store: options.store!,
            workspace: options.workspace,
            keyInput: options.keyInput,
            itemId: selected.item.id,
            screen: options.promptScreen,
            background: context?.background,
          });

          if (flowResult.type === "exit") {
            return { type: "exit" };
          }

          if (flowResult.type === "completed" && flowResult.removedItemId !== undefined) {
            controller.removeItem(flowResult.removedItemId);
          }

          return { type: "continue", message: flowResult.message };
        }),
      onMissingSecrets: options.store === undefined
        ? undefined
        : (context: { itemId: string; background?: string }) => runSecretsFlow({
          store: options.store!,
          workspace: options.workspace,
          itemId: context.itemId,
          controller,
          keyInput: options.keyInput,
          screen: options.promptScreen,
          background: context.background,
        }),
      onManageSavedLogs: options.logFiles === undefined
        ? undefined
        : async (context: { background?: string }) => {
          const result = await runWorkspaceSavedLogs({
            logFiles: options.logFiles!,
            controller,
            keyInput: options.keyInput,
            screen: options.promptScreen,
            background: context.background,
            saving: options.settings?.persistLogs.isEnabled() ?? false,
          });

          return result === "exit" ? { type: "exit" as const } : { type: "continue" as const };
        },
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

async function loadItem(store: WorkspaceConfigReader, workspaceId: string, itemId: string): Promise<ItemConfig | undefined> {
  const config = await store.load();
  const workspace = config.workspaces.find((candidate) => candidate.id === workspaceId);

  return workspace === undefined ? undefined : findItem(workspace, itemId);
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
  const selectedServiceState = getSelectedService(options.controller.getState());

  if (selectedServiceState === undefined) {
    return { type: "continue", message: "Add a service first." };
  }

  const config = await options.store.load();
  const workspace = config.workspaces.find((candidate) => candidate.id === options.workspace.id);

  if (workspace === undefined) {
    return { type: "continue", message: `Workspace "${options.workspace.name}" was not found.` };
  }

  const services = servicesOf(workspace);
  const serviceIndex = services.findIndex((service) => service.id === selectedServiceState.item.id);
  const service = services[serviceIndex];

  if (service === undefined) {
    return { type: "continue", message: `Service "${selectedServiceState.item.name}" was not found.` };
  }

  if (serviceIndex === (options.direction === "up" ? 0 : services.length - 1)) {
    return {
      type: "continue",
      message: `Service "${service.name}" is already ${options.direction === "up" ? "first" : "last"}.`,
    };
  }

  await options.store.save({
    ...config,
    workspaces: config.workspaces.map((candidate) =>
      candidate.id === workspace.id ? moveService(candidate, service.id, options.direction) : candidate,
    ),
  });

  options.controller.moveService(service.id, options.direction);

  return { type: "continue", message: `Moved service "${service.name}" ${options.direction}.` };
}
