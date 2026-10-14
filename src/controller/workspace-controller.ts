import path from "node:path";
import type { ItemConfig, ItemKind, WorkspaceConfig } from "../config/config-types.js";
import type { ManagedProcessState, ServiceLogEntry, StopFailure } from "../process/process-manager.js";
import { missingSecretsOf } from "../config/workspace-items.js";
import { runStartPlan, type StartPlan } from "./start-plan.js";
import {
  addItemToRuntimeState,
  createRuntimeState,
  getSelectedItem,
  moveServiceInRuntimeState,
  removeItemFromRuntimeState,
  selectNextItem,
  selectPreviousItem,
  setQueueStateInRuntimeState,
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
  // How long a service must stay alive before the items that wait for it start.
  upAfterMs?: number;
  pollMs?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  // Output an item saved in an earlier run, shown above this run's output when it is available.
  earlierOutput?: (item: { workspace: string; name: string; kind: ItemKind }) => Promise<ServiceLogEntry[]>;
};

export type DescribedItem = { workspace: string; name: string; kind: ItemKind };

const defaultUpAfterMs = 5_000;
const defaultPollMs = 200;

export class WorkspaceController {
  private state: RuntimeWorkspaceState;
  private readonly processManager: WorkspaceProcessManager;
  private readonly timing: Required<Pick<WorkspaceControllerOptions, "upAfterMs" | "pollMs" | "now" | "sleep">>;
  private activePlan: Promise<void> | undefined;
  // Items the user stopped while they were still waiting for a prerequisite.
  private readonly droppedIds = new Set<string>();
  private closing = false;
  private readonly earlierOutput: WorkspaceControllerOptions["earlierOutput"];
  private readonly earlier = new Map<string, ServiceLogEntry[]>();
  private readonly earlierRequested = new Set<string>();

  constructor(options: WorkspaceControllerOptions) {
    this.state = createRuntimeState(options.workspace);
    this.processManager = options.processManager;
    this.earlierOutput = options.earlierOutput;
    this.timing = {
      upAfterMs: options.upAfterMs ?? defaultUpAfterMs,
      pollMs: options.pollMs ?? defaultPollMs,
      now: options.now ?? Date.now,
      sleep: options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))),
    };
  }

  getState(): RuntimeWorkspaceState {
    this.syncProcessStates();

    return this.state;
  }

  // Starts the auto-start services in dependency order. Returns once everything that could
  // start right away has; items still waiting for a prerequisite keep going in the background.
  async startAutoStartServices(): Promise<void> {
    await this.startPlan(
      this.state.items
        .map((itemState) => itemState.item)
        .filter((item) => item.autoStart === true)
        .map((item) => item.id),
    );
  }

  // Starts these items and whatever they wait for, in order. Returns after the first pass.
  async startPlan(itemIds: string[]): Promise<void> {
    if (this.activePlan !== undefined) {
      await this.activePlan;
    }

    const plan = this.beginPlan(itemIds);

    await plan.firstPass;
  }

  // Starts every service (and the commands they wait for) without waiting for it to finish.
  // "busy" when a start is already under way.
  startAll(): "started" | "busy" | "nothing" {
    if (this.activePlan !== undefined) {
      return "busy";
    }

    const targets = this.state.items.filter(
      ({ item }) => item.kind === "service" || item.autoStart === true,
    );

    if (targets.length === 0) {
      return "nothing";
    }

    this.beginPlan(targets.map(({ item }) => item.id));

    return "started";
  }

  isStarting(): boolean {
    return this.activePlan !== undefined;
  }

  // Resolves when the current start-all plan, if any, has finished.
  async whenStarted(): Promise<void> {
    await this.activePlan;
  }

  async startItem(itemId: string): Promise<ManagedProcessState> {
    const item = this.findItem(itemId);

    if (item === undefined) {
      return { status: "stopped" };
    }

    this.droppedIds.delete(itemId);
    this.setQueue(itemId, undefined);

    // Never run an item without a secret it needs: it would fail in a confusing way, or run against the wrong thing.
    const missing = missingSecretsOf(item);

    if (missing.length > 0) {
      const refused: ManagedProcessState = { status: "failed", error: new Error(`needs ${missing.join(", ")}`) };

      this.state = updateProcessState(this.state, itemId, refused);

      return refused;
    }

    return this.runProcessAction(itemId, () =>
      this.processManager.start(this.withResolvedDirectory(item)),
    );
  }

  async stopItem(itemId: string): Promise<ManagedProcessState> {
    if (this.findItem(itemId) === undefined) {
      return { status: "stopped" };
    }

    // Stopping an item the plan is still holding back cancels its start.
    if (this.state.items[this.state.itemIndexById[itemId]!]?.queue?.status === "waiting") {
      this.droppedIds.add(itemId);
      this.setQueue(itemId, undefined);

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
    if (this.findItem(itemId) === undefined) {
      return [];
    }

    const current = this.processManager.getLogs(itemId);

    this.requestEarlier(itemId);

    const earlier = this.earlier.get(itemId);
    const last = earlier?.at(-1);

    return earlier === undefined || last === undefined
      ? current
      : [...earlier, { stream: "system", line: "saved output above, new output below", timestamp: last.timestamp, saved: true }, ...current];
  }

  // Forgets the saved output shown above an item's new output, after its saved logs were deleted.
  clearEarlierOutput(itemIds?: string[]): void {
    for (const itemId of itemIds ?? [...this.earlier.keys()]) {
      this.earlier.delete(itemId);
    }
  }

  // What a log file needs to know about an item: which workspace, name and kind it belongs to.
  describeItem(itemId: string): DescribedItem | undefined {
    const item = this.findItem(itemId);

    return item === undefined ? undefined : { workspace: this.state.workspace.name, name: item.name, kind: item.kind };
  }

  getSelectedServiceLogs(): ServiceLogEntry[] {
    const selected = getSelectedItem(this.state);

    return selected === undefined ? [] : this.getItemLogs(selected.item.id);
  }

  async shutdown(): Promise<ShutdownFailure[]> {
    this.closing = true;

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

  // Looks for saved output the first time an item's log is asked for; it appears on a later redraw.
  private requestEarlier(itemId: string): void {
    const described = this.describeItem(itemId);

    if (this.earlierOutput === undefined || described === undefined || this.earlierRequested.has(itemId)) {
      return;
    }

    this.earlierRequested.add(itemId);
    this.earlierOutput(described).then(
      (entries) => {
        if (entries.length > 0) {
          this.earlier.set(itemId, entries);
        }
      },
      () => undefined,
    );
  }

  private beginPlan(targetIds: string[]): StartPlan {
    const plan = runStartPlan({
      items: this.state.items.map(({ item }) => ({ id: item.id, name: item.name, kind: item.kind, after: item.after })),
      targets: targetIds,
      getProcess: (itemId) => this.processManager.getState(itemId),
      start: (itemId) => this.startItem(itemId),
      mark: (itemId, mark) => this.setQueue(itemId, mark),
      isDropped: (itemId) => this.closing || this.droppedIds.has(itemId),
      blockedReason: (itemId) => {
        const item = this.findItem(itemId);
        const missing = item === undefined ? [] : missingSecretsOf(item);

        return missing.length === 0 ? undefined : `needs ${missing.join(", ")}`;
      },
      ...this.timing,
    });
    const tracked = plan.done.finally(() => {
      if (this.activePlan === tracked) {
        this.activePlan = undefined;
      }
    });

    this.activePlan = tracked;
    tracked.catch(() => undefined);

    return plan;
  }

  private setQueue(itemId: string, queue: Parameters<typeof setQueueStateInRuntimeState>[2]): void {
    this.state = setQueueStateInRuntimeState(this.state, itemId, queue);
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
