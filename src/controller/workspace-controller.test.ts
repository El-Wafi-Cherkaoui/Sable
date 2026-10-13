import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { CommandConfig, ServiceConfig, WorkspaceConfig } from "../config/config-types.js";
import type { ManagedProcessState, ServiceLogEntry } from "../process/process-manager.js";
import {
  formatShutdownFailure,
  WorkspaceController,
  type WorkspaceProcessManager,
} from "./workspace-controller.js";

describe("WorkspaceController", () => {
  it("initializes runtime state from a workspace", () => {
    const controller = new WorkspaceController({
      workspace: createWorkspace(),
      processManager: createFakeProcessManager(),
    });

    expect(controller.getState().workspace).toEqual({
      id: "ws_ecommerce",
      name: "ecommerce",
      projectDirectory: process.cwd(),
    });
    expect(controller.getState().items.map((state) => state.process)).toEqual([
      { status: "stopped" },
      { status: "stopped" },
      { status: "stopped" },
    ]);
  });

  it("starts only auto-start services", async () => {
    const processManager = createFakeProcessManager();
    const controller = new WorkspaceController({
      workspace: createWorkspace(),
      processManager,
    });

    await controller.startAutoStartServices();

    expect(processManager.startedServiceIds).toEqual(["svc_backend", "svc_frontend"]);
    expect(controller.getState().items.map((state) => state.process.status)).toEqual([
      "running",
      "running",
      "stopped",
    ]);
  });

  it("starts auto-start services in parallel", async () => {
    const startedServiceIds: string[] = [];
    const resolvers: Array<(state: ManagedProcessState) => void> = [];
    const processManager = createFakeProcessManager({
      start: vi.fn((service: ServiceConfig) => {
        startedServiceIds.push(service.id);

        return new Promise<ManagedProcessState>((resolve) => {
          resolvers.push(resolve);
        });
      }),
    });
    const controller = new WorkspaceController({
      workspace: createWorkspace(),
      processManager,
    });

    const autoStartPromise = controller.startAutoStartServices();

    expect(startedServiceIds).toEqual(["svc_backend", "svc_frontend"]);

    resolvers.forEach((resolve, index) => {
      resolve({ status: "running", pid: index + 1 });
    });
    await autoStartPromise;
  });

  it("isolates auto-start failures from other services", async () => {
    const processManager = createFakeProcessManager();
    processManager.start = vi.fn((service: ServiceConfig) => {
      if (service.id === "svc_backend") {
        throw new Error("backend failed");
      }

      const state: ManagedProcessState = { status: "running", pid: 1234 };
      processManager.states.set(service.id, state);

      return state;
    });
    const controller = new WorkspaceController({
      workspace: createWorkspace(),
      processManager,
    });

    await controller.startAutoStartServices();

    expect(controller.getState().items.map((state) => state.process.status)).toEqual([
      "failed",
      "running",
      "stopped",
    ]);
  });

  it("runs services and commands with relative folders inside the project folder", async () => {
    const started: Array<{ id: string; cwd: string }> = [];
    const processManager = createFakeProcessManager({
      start(item) {
        started.push({ id: item.id, cwd: item.cwd });
        return { status: "running", pid: 1 };
      },
      async restart(item) {
        started.push({ id: item.id, cwd: item.cwd });
        return { status: "running", pid: 2 };
      },
    });
    const projectDirectory = path.resolve(path.sep, "srv", "shop");
    const controller = new WorkspaceController({
      workspace: {
        id: "ws_shop",
        name: "shop",
        projectDirectory,
        items: [
          { ...createService({ id: "svc_rel", name: "rel", cwd: "api" }), kind: "service" },
          { ...createService({ id: "svc_abs", name: "abs", cwd: path.resolve(path.sep, "elsewhere") }), kind: "service" }, { kind: "command", after: [], id: "cmd_dot", name: "dot", command: "make", cwd: ".", env: {} },
        ],
      },
      processManager,
    });

    await controller.startItem("svc_rel");
    await controller.restartItem("svc_abs");
    await controller.startItem("cmd_dot");

    expect(started).toEqual([
      { id: "svc_rel", cwd: path.join(projectDirectory, "api") },
      { id: "svc_abs", cwd: path.resolve(path.sep, "elsewhere") },
      { id: "cmd_dot", cwd: projectDirectory },
    ]);
  });

  it("starts, stops, and restarts one service by id", async () => {
    const processManager = createFakeProcessManager();
    const controller = new WorkspaceController({
      workspace: createWorkspace(),
      processManager,
    });

    await controller.startItem("svc_worker");
    expect(processManager.startedServiceIds).toEqual(["svc_worker"]);
    expect(serviceStatus(controller, "svc_worker")).toBe("running");

    await controller.stopItem("svc_worker");
    expect(processManager.stoppedServiceIds).toEqual(["svc_worker"]);
    expect(serviceStatus(controller, "svc_worker")).toBe("stopped");

    await controller.restartItem("svc_worker");
    expect(processManager.restartedServiceIds).toEqual(["svc_worker"]);
    expect(serviceStatus(controller, "svc_worker")).toBe("running");
  });

  it("runs a command again when it is restarted, instead of restarting a process", async () => {
    const processManager = createFakeProcessManager();
    const controller = new WorkspaceController({
      workspace: { id: "ws_cmd", name: "cmd", projectDirectory: process.cwd(), items: [createCommand()] },
      processManager,
    });

    await controller.restartItem("cmd_build");

    expect(processManager.startedServiceIds).toEqual(["cmd_build"]);
    expect(processManager.restartedServiceIds).toEqual([]);
    expect(controller.getState().items[0]?.process.status).toBe("running");
  });

  it("only auto-starts services marked auto-start, never commands", async () => {
    const processManager = createFakeProcessManager();
    const controller = new WorkspaceController({
      workspace: {
        id: "ws_auto",
        name: "auto",
        projectDirectory: process.cwd(),
        items: [
          createCommand(),
          createService({ id: "svc_on", name: "on" }),
          createService({ id: "svc_off", name: "off", autoStart: false }),
        ],
      },
      processManager,
    });

    await controller.startAutoStartServices();

    expect(processManager.startedServiceIds).toEqual(["svc_on"]);
  });

  it("starts, stops, and restarts the selected service", async () => {
    const processManager = createFakeProcessManager();
    const controller = new WorkspaceController({
      workspace: createWorkspace(),
      processManager,
    });

    controller.selectPreviousService();

    await controller.startSelectedService();
    expect(processManager.startedServiceIds).toEqual(["svc_worker"]);
    expect(serviceStatus(controller, "svc_worker")).toBe("running");

    await controller.stopSelectedService();
    expect(processManager.stoppedServiceIds).toEqual(["svc_worker"]);
    expect(serviceStatus(controller, "svc_worker")).toBe("stopped");

    await controller.restartSelectedService();
    expect(processManager.restartedServiceIds).toEqual(["svc_worker"]);
    expect(serviceStatus(controller, "svc_worker")).toBe("running");
  });

  it("ignores selected service actions when a workspace has no services", async () => {
    const processManager = createFakeProcessManager();
    const controller = new WorkspaceController({
      workspace: { id: "ws_empty", name: "empty", items: [] },
      processManager,
    });

    await expect(controller.startSelectedService()).resolves.toEqual({
      status: "stopped",
    });
    await expect(controller.stopSelectedService()).resolves.toEqual({
      status: "stopped",
    });
    await expect(controller.restartSelectedService()).resolves.toEqual({
      status: "stopped",
    });
    expect(processManager.startedServiceIds).toEqual([]);
    expect(processManager.stoppedServiceIds).toEqual([]);
    expect(processManager.restartedServiceIds).toEqual([]);
  });

  it("ignores unknown service ids safely", async () => {
    const processManager = createFakeProcessManager();
    const controller = new WorkspaceController({
      workspace: createWorkspace(),
      processManager,
    });

    await expect(controller.startItem("missing")).resolves.toEqual({
      status: "stopped",
    });
    await expect(controller.stopItem("missing")).resolves.toEqual({
      status: "stopped",
    });
    await expect(controller.restartItem("missing")).resolves.toEqual({
      status: "stopped",
    });
    expect(processManager.startedServiceIds).toEqual([]);
    expect(processManager.stoppedServiceIds).toEqual([]);
    expect(processManager.restartedServiceIds).toEqual([]);
  });

  it("wraps service selection through runtime state", () => {
    const controller = new WorkspaceController({
      workspace: createWorkspace(),
      processManager: createFakeProcessManager(),
    });

    expect(controller.getState().selectedItemIndex).toBe(0);
    controller.selectPreviousService();
    expect(controller.getState().selectedItemIndex).toBe(2);
    controller.selectNextService();
    expect(controller.getState().selectedItemIndex).toBe(0);
  });

  it("adds a service to runtime state", () => {
    const controller = new WorkspaceController({
      workspace: { id: "ws_empty", name: "empty", projectDirectory: process.cwd(), items: [] },
      processManager: createFakeProcessManager(),
    });

    controller.addItem(createService({ id: "svc_api", name: "api" }));

    expect(controller.getState().items.map((serviceState) => serviceState.item.id)).toEqual(["svc_api"]);
    expect(controller.getState().selectedItemIndex).toBe(0);
  });

  it("adds a command to runtime state", () => {
    const controller = new WorkspaceController({
      workspace: { id: "ws_empty", name: "empty", projectDirectory: process.cwd(), items: [] },
      processManager: createFakeProcessManager(),
    });

    controller.addItem(createCommand());

    expect(controller.getState().items.map((commandState) => commandState.item.id)).toEqual(["cmd_build"]);
    expect(controller.getState().selectedItemIndex).toBe(0);
  });

  it("updates and removes services in runtime state", () => {
    const controller = new WorkspaceController({
      workspace: createWorkspace(),
      processManager: createFakeProcessManager(),
    });

    controller.updateItem({
      ...controller.getState().items[0]!.item,
      command: "npm run changed",
    });
    expect(controller.getState().items[0]?.item.command).toBe("npm run changed");

    controller.removeItem("svc_backend");
    expect(controller.getState().items.map((serviceState) => serviceState.item.id)).toEqual([
      "svc_frontend",
      "svc_worker",
    ]);
  });

  it("reads logs for a service and the selected service", () => {
    const processManager = createFakeProcessManager({
      getLogs: vi.fn((serviceId: string) => [
        {
          stream: "stdout" as const,
          line: `${serviceId} log`,
          timestamp: new Date("2026-01-01T00:00:00.000Z"),
        },
      ]),
    });
    const controller = new WorkspaceController({
      workspace: createWorkspace(),
      processManager,
    });

    expect(controller.getItemLogs("svc_frontend").map((entry) => entry.line)).toEqual([
      "svc_frontend log",
    ]);
    expect(controller.getSelectedServiceLogs().map((entry) => entry.line)).toEqual([
      "svc_backend log",
    ]);
    expect(controller.getItemLogs("missing")).toEqual([]);
  });

  it("runs selected commands and reads their output logs", async () => {
    const processManager = createFakeProcessManager({
      getLogs: vi.fn((id: string) => [
        { stream: "stdout" as const, line: `${id} output`, timestamp: new Date() },
      ]),
    });
    const controller = new WorkspaceController({
      workspace: {
        id: "ws_scripts",
        name: "scripts",
        projectDirectory: process.cwd(),
        items: [{ ...createCommand(), kind: "command" }],
      },
      processManager,
    });

    await controller.restartSelectedService();

    expect(processManager.startedServiceIds).toEqual(["cmd_build"]);
    expect(controller.getState().items[0]?.process.status).toBe("running");
    expect(controller.getSelectedServiceLogs().map((entry) => entry.line)).toEqual(["cmd_build output"]);
  });


  it("moves services while preserving process state", () => {
    const processManager = createFakeProcessManager();
    const controller = new WorkspaceController({
      workspace: createWorkspace(),
      processManager,
    });

    controller.moveService("svc_frontend", "up");

    expect(controller.getState().items.map((serviceState) => serviceState.item.id)).toEqual([
      "svc_frontend",
      "svc_backend",
      "svc_worker",
    ]);
    expect(controller.getState().selectedItemIndex).toBe(0);
  });

  it("shuts down all managed services", async () => {
    const processManager = createFakeProcessManager();
    const controller = new WorkspaceController({
      workspace: createWorkspace(),
      processManager,
    });

    await controller.shutdown();

    expect(processManager.stopAll).toHaveBeenCalledOnce();
  });

  it("reports processes that failed to stop by item name", async () => {
    const processManager = createFakeProcessManager();
    processManager.stopAll.mockResolvedValueOnce([
      { id: "svc_backend", pid: 1234, error: new Error("Process did not stop.") },
      { id: "svc_unknown", error: new Error("tree kill failed") },
    ]);
    const controller = new WorkspaceController({
      workspace: createWorkspace(),
      processManager,
    });

    await expect(controller.shutdown()).resolves.toEqual([
      { name: "backend", pid: 1234, message: "Process did not stop." },
      { name: "svc_unknown", pid: undefined, message: "tree kill failed" },
    ]);
  });

  it("formats shutdown failures for warnings", () => {
    expect(formatShutdownFailure({ name: "api", pid: 42, message: "Process did not stop." })).toBe(
      '"api" (pid 42) may still be running: Process did not stop.',
    );
    expect(formatShutdownFailure({ name: "api", message: "tree kill failed" })).toBe(
      '"api" may still be running: tree kill failed',
    );
  });
});

type FakeProcessManager = WorkspaceProcessManager & {
  startedServiceIds: string[];
  stoppedServiceIds: string[];
  restartedServiceIds: string[];
  states: Map<string, ManagedProcessState>;
  stopAll: ReturnType<typeof vi.fn>;
};

describe("WorkspaceController start order", () => {
  function workspaceWith(...items: WorkspaceConfig["items"]): WorkspaceConfig {
    return { id: "ws_deps", name: "deps", projectDirectory: process.cwd(), items };
  }

  const db = createService({ id: "svc_db", name: "db" });
  const api = createService({ id: "svc_api", name: "api", after: ["svc_db"] });
  const build: CommandConfig = { ...createCommand(), id: "cmd_build", name: "build" };

  // Sleeping only ends when the test advances the clock, so a plan can be inspected midway.
  function manualClock() {
    let time = 0;
    const gates: Array<() => void> = [];
    const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

    return {
      now: () => time,
      sleep: (milliseconds: number) => new Promise<void>((resolve) => {
        gates.push(() => {
          time += milliseconds;
          resolve();
        });
      }),
      async advance(milliseconds: number) {
        const target = time + milliseconds;

        await flush();

        while (time < target && gates.length > 0) {
          gates.shift()!();
          await flush();
        }
      },
    };
  }

  function createController(workspace: WorkspaceConfig, processManager = createFakeProcessManager()) {
    const clock = manualClock();
    const controller = new WorkspaceController({
      workspace,
      processManager,
      upAfterMs: 1000,
      pollMs: 500,
      now: clock.now,
      sleep: clock.sleep,
    });

    return { controller, clock, processManager };
  }

  const queueOf = (controller: WorkspaceController, id: string) =>
    controller.getState().items[controller.getState().itemIndexById[id]!]?.queue;

  it("starts an auto-start service only after the one it waits for has been up for a while", async () => {
    const { controller, clock, processManager } = createController(workspaceWith(db, api));

    await controller.startAutoStartServices();

    expect(processManager.startedServiceIds).toEqual(["svc_db"]);
    expect(queueOf(controller, "svc_api")).toEqual({ status: "waiting", for: ["db"] });
    expect(controller.isStarting()).toBe(true);

    await clock.advance(1000);

    expect(processManager.startedServiceIds).toEqual(["svc_db", "svc_api"]);
    expect(queueOf(controller, "svc_api")).toBeUndefined();

    await clock.advance(1000);
    await controller.whenStarted();

    expect(controller.isStarting()).toBe(false);
  });

  it("starts every service with start all, including ones that are not auto-start, and runs the commands they wait for", async () => {
    const manual = createService({ id: "svc_manual", name: "manual", autoStart: false, after: ["cmd_build"] });
    const { controller, clock, processManager } = createController(workspaceWith(db, manual, build));

    expect(controller.startAll()).toBe("started");
    expect(controller.startAll()).toBe("busy");

    await clock.advance(500);
    processManager.states.set("cmd_build", { status: "exited", exitCode: 0, signal: null });
    await clock.advance(2000);
    await controller.whenStarted();

    expect(processManager.startedServiceIds.sort()).toEqual(["cmd_build", "svc_db", "svc_manual"]);
    expect(controller.startAll()).toBe("started");
  });

  it("has nothing to start when the workspace has no services", () => {
    const { controller } = createController(workspaceWith(build));

    expect(controller.startAll()).toBe("nothing");
  });

  it("cancels the start of an item that is still waiting when it is stopped", async () => {
    const { controller, clock, processManager } = createController(workspaceWith(db, api));

    await controller.startAutoStartServices();
    await controller.stopItem("svc_api");

    expect(queueOf(controller, "svc_api")).toBeUndefined();
    expect(processManager.stoppedServiceIds).toEqual([]);

    await clock.advance(1000);
    await controller.whenStarted();

    expect(processManager.startedServiceIds).toEqual(["svc_db"]);
  });

  it("lets an item that was cancelled be started by hand afterwards", async () => {
    const { controller, clock, processManager } = createController(workspaceWith(db, api));

    await controller.startAutoStartServices();
    await controller.stopItem("svc_api");
    await controller.startItem("svc_api");

    expect(processManager.startedServiceIds).toEqual(["svc_db", "svc_api"]);

    await clock.advance(2000);
    await controller.whenStarted();
  });

  it("stops waiting for anything when the workspace shuts down", async () => {
    const { controller, clock, processManager } = createController(workspaceWith(db, api));

    await controller.startAutoStartServices();
    await controller.shutdown();
    await clock.advance(500);
    await controller.whenStarted();

    expect(processManager.startedServiceIds).toEqual(["svc_db"]);
    expect(queueOf(controller, "svc_api")).toBeUndefined();
  });

  it("keeps a skipped mark visible until the item is started again", async () => {
    const { controller, clock, processManager } = createController(workspaceWith(build, createService({ id: "svc_web", name: "web", after: ["cmd_build"] })));

    controller.startAll();
    await clock.advance(500);
    processManager.states.set("cmd_build", { status: "exited", exitCode: 1, signal: null });
    await clock.advance(500);
    await controller.whenStarted();

    expect(queueOf(controller, "svc_web")).toEqual({ status: "skipped", reason: "build failed" });

    await controller.startItem("svc_web");

    expect(queueOf(controller, "svc_web")).toBeUndefined();
  });

  it("stops items waiting for one that is removed", () => {
    const { controller } = createController(workspaceWith(db, api));

    controller.removeItem("svc_db");

    expect(controller.getState().items.map((itemState) => itemState.item.after)).toEqual([[]]);
  });
});

describe("WorkspaceController earlier output", () => {
  const saved = (line: string): ServiceLogEntry => ({ stream: "stdout", line, timestamp: new Date("2026-10-12T09:00:00Z") });
  const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

  it("shows output saved by an earlier run above this run's, once it has been read", async () => {
    const earlierOutput = vi.fn(async () => [saved("crashed: out of memory")]);
    const processManager = createFakeProcessManager({ getLogs: vi.fn(() => [saved("service started")]) });
    const controller = new WorkspaceController({ workspace: createWorkspace(), processManager, earlierOutput });

    expect(controller.getItemLogs("svc_backend").map((entry) => entry.line)).toEqual(["service started"]);

    await flush();

    expect(earlierOutput).toHaveBeenCalledWith({ workspace: "ecommerce", name: "backend", kind: "service" });
    expect(controller.getItemLogs("svc_backend").map((entry) => entry.line)).toEqual([
      "crashed: out of memory",
      "earlier run above, this run below",
      "service started",
    ]);
  });

  it("asks for each item's saved output only once, and not for items that do not exist", async () => {
    const earlierOutput = vi.fn(async () => [] as ServiceLogEntry[]);
    const controller = new WorkspaceController({ workspace: createWorkspace(), processManager: createFakeProcessManager(), earlierOutput });

    controller.getItemLogs("svc_backend");
    controller.getItemLogs("svc_backend");
    controller.getItemLogs("svc_frontend");
    controller.getItemLogs("missing");
    await flush();

    expect(earlierOutput).toHaveBeenCalledTimes(2);
    expect(controller.getItemLogs("svc_backend")).toEqual([]);
  });

  it("carries on when reading the saved output fails", async () => {
    const earlierOutput = vi.fn(async () => {
      throw new Error("unreadable");
    });
    const controller = new WorkspaceController({ workspace: createWorkspace(), processManager: createFakeProcessManager(), earlierOutput });

    controller.getItemLogs("svc_backend");
    await flush();

    expect(controller.getItemLogs("svc_backend")).toEqual([]);
  });

  it("describes an item for the log file: its workspace, name and kind", () => {
    const controller = new WorkspaceController({ workspace: createWorkspace(), processManager: createFakeProcessManager() });

    expect(controller.describeItem("svc_worker")).toEqual({ workspace: "ecommerce", name: "worker", kind: "service" });
    expect(controller.describeItem("missing")).toBeUndefined();
  });
});

function createFakeProcessManager(
  overrides: Partial<WorkspaceProcessManager> = {},
): FakeProcessManager {
  const processManager: FakeProcessManager = {
    startedServiceIds: [],
    stoppedServiceIds: [],
    restartedServiceIds: [],
    states: new Map<string, ManagedProcessState>(),
    start(service) {
      this.startedServiceIds.push(service.id);
      const state: ManagedProcessState = { status: "running", pid: this.startedServiceIds.length };
      this.states.set(service.id, state);

      return state;
    },
    async stop(serviceId) {
      this.stoppedServiceIds.push(serviceId);
      const state: ManagedProcessState = { status: "stopped" };
      this.states.set(serviceId, state);

      return state;
    },
    async restart(service) {
      this.restartedServiceIds.push(service.id);
      const state: ManagedProcessState = { status: "running", pid: this.restartedServiceIds.length };
      this.states.set(service.id, state);

      return state;
    },
    getState(serviceId) {
      return this.states.get(serviceId) ?? { status: "stopped" };
    },
    getLogs: vi.fn(() => []),
    stopAll: vi.fn(async () => []),
  };

  return Object.assign(processManager, overrides);
}

function serviceStatus(
  controller: WorkspaceController,
  serviceId: string,
): ManagedProcessState["status"] | undefined {
  const serviceIndex = controller.getState().itemIndexById[serviceId];

  return serviceIndex === undefined
    ? undefined
    : controller.getState().items[serviceIndex]?.process.status;
}

function createWorkspace(): WorkspaceConfig {
    return {
      id: "ws_ecommerce",
      name: "ecommerce",
      projectDirectory: process.cwd(),
      items: [
      { ...createService({ id: "svc_backend", name: "backend", autoStart: true }), kind: "service" },
      { ...createService({ id: "svc_frontend", name: "frontend", autoStart: true }), kind: "service" },
      { ...createService({ id: "svc_worker", name: "worker", autoStart: false }), kind: "service" },
    ],
  };
}

function createCommand(): CommandConfig {
  return {
    kind: "command", after: [],
    id: "cmd_build",
    name: "build",
    command: "npm run build",
    cwd: ".",
    env: {},
  };
}

function createService(overrides: Partial<ServiceConfig>): ServiceConfig {
  return {
    kind: "service", after: [],
    id: "svc_service",
    name: "service",
    command: "npm run dev",
    cwd: ".",
    autoStart: true,
    env: {},
    ...overrides,
  };
}
