import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ServiceConfig } from "../config/config-types.js";
import { ProcessManager, type ProcessStatus } from "./process-manager.js";

let manager: ProcessManager;

afterEach(async () => {
  await manager?.stopAll();
});

describe("ProcessManager", () => {
  it("starts a service command", () => {
    manager = createManager();

    const state = manager.start(createService({ command: nodeCommand("setInterval(() => {}, 1000);") }));

    expect(state.status).toBe("running");
    expect(state).toMatchObject({ pid: expect.any(Number) });
  });

  it("updates state when a service exits naturally", async () => {
    manager = createManager();
    const service = createService({ command: nodeCommand("process.exit(7);") });

    manager.start(service);

    await waitForStatus(manager, service.id, "exited");

    expect(manager.getState(service.id)).toEqual({
      status: "exited",
      exitCode: 7,
      signal: null,
    });
  });

  it("records failed state when a service cannot spawn", async () => {
    manager = createManager();
    const service = createService({ cwd: path.join(os.tmpdir(), "sable-missing-cwd") });

    manager.start(service);

    await waitForStatus(manager, service.id, "failed");

    expect(manager.getState(service.id).status).toBe("failed");
  });

  it("does not start duplicate processes for a running service", () => {
    manager = createManager();
    const service = createService({ command: nodeCommand("setInterval(() => {}, 1000);") });

    const firstState = manager.start(service);
    const secondState = manager.start(service);

    expect(firstState.status).toBe("running");
    expect(secondState.status).toBe("running");
    expect(secondState).toEqual(firstState);
  });

  it("stops a running service", async () => {
    manager = createManager();
    const service = createService({ command: nodeCommand("setInterval(() => {}, 1000);") });

    manager.start(service);

    await expect(manager.stop(service.id)).resolves.toEqual({ status: "stopped" });
    expect(manager.getState(service.id)).toEqual({ status: "stopped" });
  });

  it("restarts a running service", async () => {
    manager = createManager();
    const service = createService({ command: nodeCommand("setInterval(() => {}, 1000);") });

    const firstState = manager.start(service);
    const restartedState = await manager.restart(service);

    expect(firstState.status).toBe("running");
    expect(restartedState.status).toBe("running");
    expect(restartedState).toMatchObject({ pid: expect.any(Number) });
    expect(restartedState).not.toEqual(firstState);
  });

  it("stops all running services", async () => {
    manager = createManager();
    const firstService = createService({
      id: "service-1",
      command: nodeCommand("setInterval(() => {}, 1000);"),
    });
    const secondService = createService({
      id: "service-2",
      command: nodeCommand("setInterval(() => {}, 1000);"),
    });

    manager.start(firstService);
    manager.start(secondService);

    await manager.stopAll();

    expect(manager.getState(firstService.id)).toEqual({ status: "stopped" });
    expect(manager.getState(secondService.id)).toEqual({ status: "stopped" });
  });
});

function createManager(): ProcessManager {
  return new ProcessManager({
    gracefulStopTimeoutMs: 250,
    forceStopTimeoutMs: 250,
  });
}

function createService(overrides: Partial<ServiceConfig> = {}): ServiceConfig {
  return {
    id: "service-1",
    name: "service",
    command: nodeCommand("setInterval(() => {}, 1000);"),
    cwd: process.cwd(),
    autoStart: true,
    env: {},
    ...overrides,
  };
}

function nodeCommand(script: string): string {
  return `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`;
}

async function waitForStatus(
  processManager: ProcessManager,
  serviceId: string,
  status: ProcessStatus,
): Promise<void> {
  const deadline = Date.now() + 1_000;

  while (Date.now() < deadline) {
    if (processManager.getState(serviceId).status === status) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  expect(processManager.getState(serviceId).status).toBe(status);
}
