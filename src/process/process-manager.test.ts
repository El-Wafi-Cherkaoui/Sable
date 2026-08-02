import os from "node:os";
import path from "node:path";
import treeKill from "tree-kill";
import { afterEach, describe, expect, it, vi } from "vitest";
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
    expect(manager.getLogs("service-1")).toContainEqual({
      stream: "system",
      line: "service started",
      timestamp: expect.any(Date),
    });
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
    expect(manager.getLogs(service.id)).toContainEqual({
      stream: "system",
      line: "process exited with code 7",
      timestamp: expect.any(Date),
    });
  });

  it("records failed state when a service cannot spawn", async () => {
    manager = createManager();
    const service = createService({ cwd: path.join(os.tmpdir(), "sable-missing-cwd") });

    manager.start(service);

    await waitForStatus(manager, service.id, "failed");

    expect(manager.getState(service.id).status).toBe("failed");
    expect(manager.getLogs(service.id).map((entry) => entry.line)).toContainEqual(
      expect.stringMatching(/^process error: /),
    );
  });

  it("does not start duplicate processes for a running service", () => {
    manager = createManager();
    const service = createService({ command: nodeCommand("setInterval(() => {}, 1000);") });

    const firstState = manager.start(service);
    const secondState = manager.start(service);

    expect(firstState.status).toBe("running");
    expect(secondState.status).toBe("running");
    expect(secondState).toEqual(firstState);
    expect(manager.getLogs(service.id).map((entry) => entry.line)).toContain(
      "service already running",
    );
  });

  it("stops a running service", async () => {
    manager = createManager();
    const service = createService({ command: nodeCommand("setInterval(() => {}, 1000);") });

    manager.start(service);

    await expect(manager.stop(service.id)).resolves.toEqual({ status: "stopped" });
    expect(manager.getState(service.id)).toEqual({ status: "stopped" });
    expect(manager.getLogs(service.id).map((entry) => entry.line)).toContain(
      "service stopped",
    );
  });

  it("stops services through the process tree killer", async () => {
    const killedPids: number[] = [];
    const killedSignals: NodeJS.Signals[] = [];
    manager = createManager({
      async processTreeKiller(pid, signal) {
        killedPids.push(pid);
        killedSignals.push(signal);
        process.kill(pid, signal);
      },
    });
    const service = createService({ command: nodeCommand("setInterval(() => {}, 1000);") });
    const state = manager.start(service);

    if (state.status !== "running" || state.pid === undefined) {
      throw new Error("Expected test service to be running.");
    }

    await manager.stop(service.id);

    expect(killedPids).toEqual([state.pid]);
    expect(killedSignals).toEqual(["SIGTERM"]);
  });

  it("marks stop as failed when process tree termination fails", async () => {
    const stopError = new Error("tree kill failed");
    let pidToKill: number | undefined;
    manager = createManager({
      processTreeKiller: vi.fn(async () => {
        if (pidToKill !== undefined) {
          await killTreeForTest(pidToKill);
        }

        throw stopError;
      }),
    });
    const service = createService({ command: nodeCommand("setInterval(() => {}, 1000);") });

    const state = manager.start(service);

    if (state.status !== "running" || state.pid === undefined) {
      throw new Error("Expected test service to be running.");
    }

    pidToKill = state.pid;

    await expect(manager.stop(service.id)).resolves.toEqual({
      status: "failed",
      error: stopError,
    });
    expect(manager.getState(service.id)).toEqual({ status: "failed", error: stopError });
    expect(manager.getLogs(service.id).map((entry) => entry.line)).toContain(
      "failed to stop service: tree kill failed",
    );
  });

  it("does not restart a service when stopping it fails", async () => {
    const stopError = new Error("tree kill failed");
    manager = createManager({
      processTreeKiller: vi.fn(async () => {
        throw stopError;
      }),
    });
    const service = createService({ command: nodeCommand("setInterval(() => {}, 1000);") });

    const firstState = manager.start(service);
    const restartState = await manager.restart(service);

    expect(firstState.status).toBe("running");
    expect(restartState).toEqual({ status: "failed", error: stopError });
    expect(manager.getState(service.id)).toEqual({ status: "failed", error: stopError });
    expect(
      manager.getLogs(service.id).filter((entry) => entry.line === "service started"),
    ).toHaveLength(1);
  });

  it("preserves failed state when a process exits after stop failure", async () => {
    const stopError = new Error("tree kill failed after termination");
    let pidToKill: number | undefined;
    manager = createManager({
      processTreeKiller: vi.fn(async () => {
        if (pidToKill !== undefined) {
          await killTreeForTest(pidToKill);
        }

        throw stopError;
      }),
    });
    const service = createService({ command: nodeCommand("setInterval(() => {}, 1000);") });
    const state = manager.start(service);

    if (state.status !== "running" || state.pid === undefined) {
      throw new Error("Expected test service to be running.");
    }

    pidToKill = state.pid;

    await expect(manager.stop(service.id)).resolves.toEqual({
      status: "failed",
      error: stopError,
    });
    await waitForStatus(manager, service.id, "failed");

    expect(manager.getState(service.id)).toEqual({ status: "failed", error: stopError });
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
    expect(manager.getLogs(service.id).map((entry) => entry.line)).toContain(
      "service restart requested",
    );
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

  it("captures stdout and stderr logs", async () => {
    manager = createManager();
    const service = createService({
      command: nodeCommand('console.log("out"); console.error("err");'),
    });

    manager.start(service);

    await waitForStatus(manager, service.id, "exited");
    await waitForLogCount(manager, service.id, 2);

    expect(
      manager
        .getLogs(service.id)
        .filter((entry) => entry.stream === "stdout" || entry.stream === "stderr"),
    ).toEqual([
      { stream: "stdout", line: "out", timestamp: expect.any(Date) },
      { stream: "stderr", line: "err", timestamp: expect.any(Date) },
    ]);
  });

  it("combines log lines split across output chunks", async () => {
    manager = createManager();
    const service = createService({
      command: nodeCommand('process.stdout.write("hel"); setTimeout(() => process.stdout.write("lo" + String.fromCharCode(10)), 20);'),
    });

    manager.start(service);

    await waitForStatus(manager, service.id, "exited");
    await waitForLogCount(manager, service.id, 3);

    expect(
      manager
        .getLogs(service.id)
        .filter((entry) => entry.stream === "stdout")
        .map((entry) => entry.line),
    ).toEqual(["hello"]);
  });

  it("flushes unterminated log lines when a process exits", async () => {
    manager = createManager();
    const service = createService({
      command: nodeCommand('process.stderr.write("unterminated error", () => process.exit(9));'),
    });

    manager.start(service);

    await waitForStatus(manager, service.id, "exited");
    await waitForLogCount(manager, service.id, 3);

    const logLines = manager.getLogs(service.id).map((entry) => entry.line);

    expect(logLines).toContain("unterminated error");
    expect(logLines.indexOf("unterminated error")).toBeLessThan(
      logLines.indexOf("process exited with code 9"),
    );
  });

  it("keeps a bounded log buffer per service", async () => {
    manager = createManager({ maxLogLinesPerService: 3 });
    const service = createService({
      command: nodeCommand(
        'for (let index = 1; index <= 5; index += 1) console.log("line-" + index);',
      ),
    });

    manager.start(service);

    await waitForStatus(manager, service.id, "exited");
    await waitForLogCount(manager, service.id, 3);

    expect(manager.getLogs(service.id)).toHaveLength(3);
    expect(manager.getLogs(service.id).map((entry) => entry.line)).toEqual([
      "line-4",
      "line-5",
      "process exited with code 0",
    ]);
  });
});

function createManager(options: ConstructorParameters<typeof ProcessManager>[0] = {}): ProcessManager {
  return new ProcessManager({
    gracefulStopTimeoutMs: 250,
    forceStopTimeoutMs: 250,
    ...options,
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
  const deadline = Date.now() + 3_000;

  while (Date.now() < deadline) {
    if (processManager.getState(serviceId).status === status) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  expect(processManager.getState(serviceId).status).toBe(status);
}

async function waitForLogCount(
  processManager: ProcessManager,
  serviceId: string,
  count: number,
): Promise<void> {
  const deadline = Date.now() + 3_000;

  while (Date.now() < deadline) {
    if (processManager.getLogs(serviceId).length >= count) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  expect(processManager.getLogs(serviceId).length).toBeGreaterThanOrEqual(count);
}

function killTreeForTest(pid: number): Promise<void> {
  return new Promise((resolve) => {
    treeKill(pid, "SIGTERM", () => resolve());
  });
}
