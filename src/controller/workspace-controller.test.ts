import { describe, expect, it, vi } from "vitest";
import type { ServiceConfig, WorkspaceConfig } from "../config/config-types.js";
import type { ManagedProcessState } from "../process/process-manager.js";
import {
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
    });
    expect(controller.getState().services.map((state) => state.process)).toEqual([
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
    expect(controller.getState().services.map((state) => state.process.status)).toEqual([
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

    expect(controller.getState().services.map((state) => state.process.status)).toEqual([
      "failed",
      "running",
      "stopped",
    ]);
  });

  it("starts, stops, and restarts one service by id", async () => {
    const processManager = createFakeProcessManager();
    const controller = new WorkspaceController({
      workspace: createWorkspace(),
      processManager,
    });

    await controller.startService("svc_worker");
    expect(processManager.startedServiceIds).toEqual(["svc_worker"]);
    expect(serviceStatus(controller, "svc_worker")).toBe("running");

    await controller.stopService("svc_worker");
    expect(processManager.stoppedServiceIds).toEqual(["svc_worker"]);
    expect(serviceStatus(controller, "svc_worker")).toBe("stopped");

    await controller.restartService("svc_worker");
    expect(processManager.restartedServiceIds).toEqual(["svc_worker"]);
    expect(serviceStatus(controller, "svc_worker")).toBe("running");
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
      workspace: { id: "ws_empty", name: "empty", services: [] },
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

    await expect(controller.startService("missing")).resolves.toEqual({
      status: "stopped",
    });
    await expect(controller.stopService("missing")).resolves.toEqual({
      status: "stopped",
    });
    await expect(controller.restartService("missing")).resolves.toEqual({
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

    expect(controller.getState().selectedServiceIndex).toBe(0);
    controller.selectPreviousService();
    expect(controller.getState().selectedServiceIndex).toBe(2);
    controller.selectNextService();
    expect(controller.getState().selectedServiceIndex).toBe(0);
  });

  it("adds a service to runtime state", () => {
    const controller = new WorkspaceController({
      workspace: { id: "ws_empty", name: "empty", projectDirectory: process.cwd(), services: [] },
      processManager: createFakeProcessManager(),
    });

    controller.addService(createService({ id: "svc_api", name: "api" }));

    expect(controller.getState().services.map((serviceState) => serviceState.service.id)).toEqual(["svc_api"]);
    expect(controller.getState().selectedServiceIndex).toBe(0);
  });

  it("adds a command to runtime state", () => {
    const controller = new WorkspaceController({
      workspace: { id: "ws_empty", name: "empty", projectDirectory: process.cwd(), services: [], commands: [] },
      processManager: createFakeProcessManager(),
    });

    controller.addCommand(createCommand());

    expect(controller.getState().commands.map((commandState) => commandState.command.id)).toEqual(["cmd_build"]);
    expect(controller.getState().selectedCommandIndex).toBe(0);
  });

  it("updates and removes services in runtime state", () => {
    const controller = new WorkspaceController({
      workspace: createWorkspace(),
      processManager: createFakeProcessManager(),
    });

    controller.updateService({
      ...controller.getState().services[0]!.service,
      command: "npm run changed",
    });
    expect(controller.getState().services[0]?.service.command).toBe("npm run changed");

    controller.removeService("svc_backend");
    expect(controller.getState().services.map((serviceState) => serviceState.service.id)).toEqual([
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

    expect(controller.getServiceLogs("svc_frontend").map((entry) => entry.line)).toEqual([
      "svc_frontend log",
    ]);
    expect(controller.getSelectedServiceLogs().map((entry) => entry.line)).toEqual([
      "svc_backend log",
    ]);
    expect(controller.getServiceLogs("missing")).toEqual([]);
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
        services: [],
        commands: [createCommand()],
      },
      processManager,
    });

    await controller.restartSelectedService();

    expect(processManager.startedServiceIds).toEqual(["cmd_build"]);
    expect(controller.getState().commands[0]?.process.status).toBe("running");
    expect(controller.getSelectedServiceLogs().map((entry) => entry.line)).toEqual(["cmd_build output"]);
  });


  it("moves services while preserving process state", () => {
    const processManager = createFakeProcessManager();
    const controller = new WorkspaceController({
      workspace: createWorkspace(),
      processManager,
    });

    controller.moveService("svc_frontend", "up");

    expect(controller.getState().services.map((serviceState) => serviceState.service.id)).toEqual([
      "svc_frontend",
      "svc_backend",
      "svc_worker",
    ]);
    expect(controller.getState().selectedServiceIndex).toBe(0);
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
});

type FakeProcessManager = WorkspaceProcessManager & {
  startedServiceIds: string[];
  stoppedServiceIds: string[];
  restartedServiceIds: string[];
  states: Map<string, ManagedProcessState>;
  stopAll: ReturnType<typeof vi.fn>;
};

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
    stopAll: vi.fn(async () => undefined),
  };

  return Object.assign(processManager, overrides);
}

function serviceStatus(
  controller: WorkspaceController,
  serviceId: string,
): ManagedProcessState["status"] | undefined {
  const serviceIndex = controller.getState().serviceIndexById[serviceId];

  return serviceIndex === undefined
    ? undefined
    : controller.getState().services[serviceIndex]?.process.status;
}

function createWorkspace(): WorkspaceConfig {
    return {
      id: "ws_ecommerce",
      name: "ecommerce",
      projectDirectory: process.cwd(),
      services: [
      createService({ id: "svc_backend", name: "backend", autoStart: true }),
      createService({ id: "svc_frontend", name: "frontend", autoStart: true }),
      createService({ id: "svc_worker", name: "worker", autoStart: false }),
    ],
    commands: [],
  };
}

function createCommand() {
  return {
    id: "cmd_build",
    name: "build",
    command: "npm run build",
    cwd: ".",
    env: {},
  };
}

function createService(overrides: Partial<ServiceConfig>): ServiceConfig {
  return {
    id: "svc_service",
    name: "service",
    command: "npm run dev",
    cwd: ".",
    autoStart: true,
    env: {},
    ...overrides,
  };
}
