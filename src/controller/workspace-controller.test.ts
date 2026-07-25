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
    const processManager = createFakeProcessManager({
      start: vi.fn((service: ServiceConfig) => {
        if (service.id === "svc_backend") {
          throw new Error("backend failed");
        }

        return { status: "running", pid: 1234 };
      }),
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
  stopAll: ReturnType<typeof vi.fn>;
};

function createFakeProcessManager(
  overrides: Partial<WorkspaceProcessManager> = {},
): FakeProcessManager {
  const processManager: FakeProcessManager = {
    startedServiceIds: [],
    stoppedServiceIds: [],
    restartedServiceIds: [],
    start(service) {
      this.startedServiceIds.push(service.id);

      return { status: "running", pid: this.startedServiceIds.length };
    },
    async stop(serviceId) {
      this.stoppedServiceIds.push(serviceId);

      return { status: "stopped" };
    },
    async restart(service) {
      this.restartedServiceIds.push(service.id);

      return { status: "running", pid: this.restartedServiceIds.length };
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
    services: [
      createService({ id: "svc_backend", name: "backend", autoStart: true }),
      createService({ id: "svc_frontend", name: "frontend", autoStart: true }),
      createService({ id: "svc_worker", name: "worker", autoStart: false }),
    ],
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
