import path from "node:path";
import type { ItemConfig, WorkspaceConfig } from "../config/config-types.js";
import type { ManagedProcessState, ServiceLogEntry, StopFailure } from "../process/process-manager.js";
import {
  addItemToRuntimeState,
  createRuntimeState,
  getSelectedItem,
  moveServiceInRuntimeState,
  removeItemFromRuntimeState,
  selectNextItem,
  selectPreviousItem,
  updateItemConfigInRuntimeState,
  updateProcessState,
  type RuntimeWorkspaceState,
} from "../runtime/runtime-state.js";

type MaybePromise<T> = T | Promise<T>;

export type WorkspaceProcessManager = {
  start(item: ItemConfig): MaybePromise<ManagedProcessState>;
  stop(itemId: string): Promise<ManagedProcessState>;
  restart(item: ItemConfig): Promise<ManagedProcessState>;
  getLogs(itemId: string): ServiceLogEntry[];
  getState(itemId: string): ManagedProcessState;
  stopAll(): Promise<StopFailure[]>;
};

export type ShutdownFailure = {
  name: string;
  pid?: number;
  message: string;
};

export function formatShutdownFailure(failure: ShutdownFailure): string {
  const pid = failure.pid === undefined ? "" : ` (pid ${failure.pid})`;

  return `"${failure.name}"${pid} may still be running: ${failure.message}`;
}

export type WorkspaceControllerOptions = {
  workspace: WorkspaceConfig;
  processManager: WorkspaceProcessManager;
};

export class WorkspaceController {
  private state: RuntimeWorkspaceState;
  private readonly processManager: WorkspaceProcessManager;

  constructor(options: WorkspaceControllerOptions) {
    this.state = createRuntimeState(options.workspace);
    this.processManager = options.processManager;
  }

  getState(): RuntimeWorkspaceState {
    this.syncProcessStates();

    return this.state;
  }

  async startAutoStartServices(): Promise<void> {
    const services = this.state.items
      .map((itemState) => itemState.item)
      .filter((item) => item.kind === "service" && item.autoStart);

    await Promise.all(services.map((service) => this.startItem(service.id)));
  }

  async startItem(itemId: string): Promise<ManagedProcessState> {
    const item = this.findItem(itemId);

    if (item === undefined) {
      return { status: "stopped" };
    }

    return this.runProcessAction(itemId, () =>
      this.processManager.start(this.withResolvedDirectory(item)),
    );
  }

  async stopItem(itemId: string): Promise<ManagedProcessState> {
    if (this.findItem(itemId) === undefined) {
      return { status: "stopped" };
    }

    return this.runProcessAction(itemId, () => this.processManager.stop(itemId));
  }

  // A command has nothing to restart, so restarting it runs it again.
  async restartItem(itemId: string): Promise<ManagedProcessState> {
    const item = this.findItem(itemId);

    if (item === undefined) {
      return { status: "stopped" };
    }

    if (item.kind === "command") {
      return this.startItem(itemId);
    }

    return this.runProcessAction(itemId, () =>
      this.processManager.restart(this.withResolvedDirectory(item)),
    );
  }

  async startSelectedService(): Promise<ManagedProcessState> {
    const selected = getSelectedItem(this.state);

    return selected === undefined ? { status: "stopped" } : this.startItem(selected.item.id);
  }

  async stopSelectedService(): Promise<ManagedProcessState> {
    const selected = getSelectedItem(this.state);

    return selected === undefined ? { status: "stopped" } : this.stopItem(selected.item.id);
  }

  async restartSelectedService(): Promise<ManagedProcessState> {
    const selected = getSelectedItem(this.state);

    return selected === undefined ? { status: "stopped" } : this.restartItem(selected.item.id);
  }

  addItem(item: ItemConfig): RuntimeWorkspaceState {
    this.state = addItemToRuntimeState(this.state, item);

    return this.state;
  }

  updateItem(item: ItemConfig): RuntimeWorkspaceState {
    this.state = updateItemConfigInRuntimeState(this.state, item);

    return this.state;
  }

  removeItem(itemId: string): RuntimeWorkspaceState {
    this.state = removeItemFromRuntimeState(this.state, itemId);

    return this.state;
  }

  moveService(serviceId: string, direction: "up" | "down"): RuntimeWorkspaceState {
    this.state = moveServiceInRuntimeState(this.state, serviceId, direction);

    return this.state;
  }

  selectNextService(): RuntimeWorkspaceState {
    this.state = selectNextItem(this.state);

    return this.state;
  }

  selectPreviousService(): RuntimeWorkspaceState {
    this.state = selectPreviousItem(this.state);

    return this.state;
  }

  getItemLogs(itemId: string): ServiceLogEntry[] {
    return this.findItem(itemId) === undefined ? [] : this.processManager.getLogs(itemId);
  }

  getSelectedServiceLogs(): ServiceLogEntry[] {
    const selected = getSelectedItem(this.state);

    return selected === undefined ? [] : this.getItemLogs(selected.item.id);
  }

  async shutdown(): Promise<ShutdownFailure[]> {
    const failures = await this.processManager.stopAll();

    return failures.map((failure) => ({
      name: this.findItem(failure.id)?.name ?? failure.id,
      pid: failure.pid,
      message: failure.error.message,
    }));
  }

  // Relative folders (e.g. hand-edited "cwd": ".") mean the project folder,
  // not wherever Sable was launched from.
  private withResolvedDirectory<T extends ItemConfig>(item: T): T {
    const projectDirectory = this.state.workspace.projectDirectory;

    return projectDirectory === undefined || path.isAbsolute(item.cwd)
      ? item
      : { ...item, cwd: path.resolve(projectDirectory, item.cwd) };
  }

  private findItem(itemId: string): ItemConfig | undefined {
    const index = this.state.itemIndexById[itemId];

    return index === undefined ? undefined : this.state.items[index]?.item;
  }

  private syncProcessStates(): void {
    for (const itemState of this.state.items) {
      const managerState = this.processManager.getState(itemState.item.id);

      // Don't overwrite a known failure with the manager's default "stopped".
      // The runtime state knows the start/restart attempt failed; the manager
      // only knows it never started a process for this id.
      if (itemState.process.status === "failed" && managerState.status === "stopped") {
        continue;
      }

      this.state = updateProcessState(this.state, itemState.item.id, managerState);
    }
  }

  private async runProcessAction(
    itemId: string,
    action: () => MaybePromise<ManagedProcessState>,
  ): Promise<ManagedProcessState> {
    let processState: ManagedProcessState;

    try {
      processState = await action();
    } catch (error) {
      processState = {
        status: "failed",
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }

    this.state = updateProcessState(this.state, itemId, processState);

    return processState;
  }
}
