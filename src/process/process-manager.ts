import { spawn, type ChildProcess } from "node:child_process";
import type { ServiceConfig } from "../config/config-types.js";

export type ProcessStatus = "stopped" | "running" | "exited" | "failed";

export type ManagedProcessState =
  | { status: "stopped" }
  | { status: "running"; pid?: number }
  | { status: "exited"; exitCode: number | null; signal: NodeJS.Signals | null }
  | { status: "failed"; error: Error };

export type ProcessManagerOptions = {
  gracefulStopTimeoutMs?: number;
  forceStopTimeoutMs?: number;
};

type ManagedProcessEntry = {
  child: ChildProcess;
  state: ManagedProcessState;
  stopRequested: boolean;
};

const defaultGracefulStopTimeoutMs = 3_000;
const defaultForceStopTimeoutMs = 1_000;

export class ProcessManager {
  private readonly processes = new Map<string, ManagedProcessEntry>();
  private readonly gracefulStopTimeoutMs: number;
  private readonly forceStopTimeoutMs: number;

  constructor(options: ProcessManagerOptions = {}) {
    this.gracefulStopTimeoutMs =
      options.gracefulStopTimeoutMs ?? defaultGracefulStopTimeoutMs;
    this.forceStopTimeoutMs =
      options.forceStopTimeoutMs ?? defaultForceStopTimeoutMs;
  }

  start(service: ServiceConfig): ManagedProcessState {
    const currentEntry = this.processes.get(service.id);

    if (currentEntry !== undefined && isActive(currentEntry)) {
      return currentEntry.state;
    }

    let child: ChildProcess;

    try {
      child = spawn(service.command, {
        cwd: service.cwd,
        env: {
          ...process.env,
          ...service.env,
        },
        shell: true,
        windowsHide: true,
      });
    } catch (error) {
      const failedState: ManagedProcessState = {
        status: "failed",
        error: toError(error),
      };

      this.processes.set(service.id, {
        child: createInactiveChildProcess(),
        state: failedState,
        stopRequested: false,
      });

      return failedState;
    }

    child.stdout?.resume();
    child.stderr?.resume();

    const entry: ManagedProcessEntry = {
      child,
      state: {
        status: "running",
        pid: child.pid,
      },
      stopRequested: false,
    };

    this.processes.set(service.id, entry);

    child.once("error", (error) => {
      entry.state = {
        status: "failed",
        error,
      };
    });

    child.once("exit", (exitCode, signal) => {
      entry.state = entry.stopRequested
        ? { status: "stopped" }
        : { status: "exited", exitCode, signal };
    });

    return entry.state;
  }

  async stop(serviceId: string): Promise<ManagedProcessState> {
    const entry = this.processes.get(serviceId);

    if (entry === undefined) {
      return { status: "stopped" };
    }

    if (!isActive(entry)) {
      return entry.state;
    }

    entry.stopRequested = true;
    entry.child.kill();

    const stoppedGracefully = await waitForExit(
      entry.child,
      this.gracefulStopTimeoutMs,
    );

    if (!stoppedGracefully && isActive(entry)) {
      entry.child.kill("SIGKILL");
      await waitForExit(entry.child, this.forceStopTimeoutMs);
    }

    if (isActive(entry)) {
      entry.state = { status: "failed", error: new Error("Process did not stop.") };
      return entry.state;
    }

    entry.state = { status: "stopped" };
    return entry.state;
  }

  async restart(service: ServiceConfig): Promise<ManagedProcessState> {
    await this.stop(service.id);

    return this.start(service);
  }

  getState(serviceId: string): ManagedProcessState {
    return this.processes.get(serviceId)?.state ?? { status: "stopped" };
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.processes.keys()].map((serviceId) => this.stop(serviceId)));
  }
}

function isActive(entry: ManagedProcessEntry): boolean {
  return entry.state.status === "running" && entry.child.exitCode === null;
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);

    const onExit = () => {
      cleanup();
      resolve(true);
    };

    const cleanup = () => {
      clearTimeout(timeout);
      child.off("exit", onExit);
    };

    child.once("exit", onExit);
  });
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function createInactiveChildProcess(): ChildProcess {
  return {
    exitCode: 1,
    signalCode: null,
  } as ChildProcess;
}
