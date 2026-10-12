import { spawn, type ChildProcess } from "node:child_process";
import treeKill from "tree-kill";
import type { CommandConfig, ServiceConfig } from "../config/config-types.js";
import { lastCarriageReturnSegment, sanitizeLogLine } from "./sanitize-output.js";

export type ProcessStatus = "stopped" | "running" | "exited" | "failed";

export type ManagedProcessState =
  | { status: "stopped" }
  | { status: "running"; pid?: number }
  | { status: "exited"; exitCode: number | null; signal: NodeJS.Signals | null }
  | { status: "failed"; error: Error };

export type ServiceLogStream = "stdout" | "stderr" | "system";
type ProcessOutputStream = Exclude<ServiceLogStream, "system">;

export type ServiceLogEntry = {
  stream: ServiceLogStream;
  line: string;
  timestamp: Date;
};

export type RunnableConfig = Pick<ServiceConfig | CommandConfig, "id" | "name" | "command" | "cwd" | "env">;

export type ProcessManagerOptions = {
  gracefulStopTimeoutMs?: number;
  forceStopTimeoutMs?: number;
  maxLogLinesPerService?: number;
  maxLogCharactersPerService?: number;
  processTreeKiller?: ProcessTreeKiller;
};

export type StopFailure = {
  id: string;
  pid?: number;
  error: Error;
};

export type ProcessTreeKiller = (
  pid: number,
  signal: NodeJS.Signals,
) => Promise<void>;

type ManagedProcessEntry = {
  child: ChildProcess;
  state: ManagedProcessState;
  stopRequested: boolean;
};
type PendingLogChunks = Partial<Record<ProcessOutputStream, string>>;

const defaultGracefulStopTimeoutMs = 3_000;
const defaultForceStopTimeoutMs = 1_000;
const defaultMaxLogLinesPerService = 2_000;
const defaultMaxLogCharactersPerService = 2_000_000;
// A line that never ends is cut here so one runaway stream can't grow without limit.
const maxUnfinishedLineCharacters = 100_000;

export class ProcessManager {
  private readonly processes = new Map<string, ManagedProcessEntry>();
  private readonly logs = new Map<string, ServiceLogEntry[]>();
  private readonly pendingLogChunks = new Map<string, PendingLogChunks>();
  private readonly gracefulStopTimeoutMs: number;
  private readonly forceStopTimeoutMs: number;
  private readonly maxLogLinesPerService: number;
  private readonly maxLogCharactersPerService: number;
  private readonly logCharacters = new Map<string, number>();
  private readonly processTreeKiller: ProcessTreeKiller;

  constructor(options: ProcessManagerOptions = {}) {
    this.gracefulStopTimeoutMs =
      options.gracefulStopTimeoutMs ?? defaultGracefulStopTimeoutMs;
    this.forceStopTimeoutMs =
      options.forceStopTimeoutMs ?? defaultForceStopTimeoutMs;
    this.maxLogLinesPerService =
      options.maxLogLinesPerService ?? defaultMaxLogLinesPerService;
    this.maxLogCharactersPerService =
      options.maxLogCharactersPerService ?? defaultMaxLogCharactersPerService;
    this.processTreeKiller = options.processTreeKiller ?? killProcessTree;
  }

  start(service: RunnableConfig): ManagedProcessState {
    const currentEntry = this.processes.get(service.id);

    if (currentEntry !== undefined && hasLiveChild(currentEntry)) {
      this.appendSystemLog(service.id, "service already running");
      return currentEntry.state;
    }

    let child: ChildProcess;

    try {
      child = spawn(service.command, {
        cwd: service.cwd,
        env: {
          ...colorEnvironment(),
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

      this.appendSystemLog(
        service.id,
        `service failed to start: ${failedState.error.message}`,
      );

      this.processes.set(service.id, {
        child: createInactiveChildProcess(),
        state: failedState,
        stopRequested: false,
      });

      return failedState;
    }

    child.stdout?.on("data", (chunk: Buffer | string) => {
      this.appendLogChunk(service.id, "stdout", chunk);
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      this.appendLogChunk(service.id, "stderr", chunk);
    });

    const entry: ManagedProcessEntry = {
      child,
      state: {
        status: "running",
        pid: child.pid,
      },
      stopRequested: false,
    };

    this.processes.set(service.id, entry);
    this.appendSystemLog(service.id, "service started");

    child.once("error", (error) => {
      entry.state = {
        status: "failed",
        error,
      };
      this.flushPendingLogs(service.id);
      this.appendSystemLog(service.id, `process error: ${error.message}`);
    });

    child.once("exit", (exitCode, signal) => {
      const shouldPreserveFailedState = entry.state.status === "failed";

      if (!shouldPreserveFailedState) {
        entry.state = entry.stopRequested
          ? { status: "stopped" }
          : { status: "exited", exitCode, signal };
      }

      this.flushPendingLogs(service.id);
      this.appendSystemLog(
        service.id,
        shouldPreserveFailedState
          ? formatProcessExitMessage(exitCode, signal)
          : entry.stopRequested
          ? "service stopped"
          : formatProcessExitMessage(exitCode, signal),
      );
    });

    return entry.state;
  }

  async stop(serviceId: string): Promise<ManagedProcessState> {
    const entry = this.processes.get(serviceId);

    if (entry === undefined) {
      return { status: "stopped" };
    }

    if (!hasLiveChild(entry)) {
      this.appendSystemLog(serviceId, "service is not running");
      return entry.state;
    }

    entry.stopRequested = true;

    try {
      await this.stopProcessTree(entry.child, "SIGTERM");
    } catch (error) {
      entry.state = { status: "failed", error: toError(error) };
      this.flushPendingLogs(serviceId);
      this.appendSystemLog(
        serviceId,
        `failed to stop service: ${entry.state.error.message}`,
      );
      return entry.state;
    }

    const stoppedGracefully = await waitForExit(
      entry.child,
      this.gracefulStopTimeoutMs,
    );

    if (!stoppedGracefully && hasLiveChild(entry)) {
      try {
        await this.stopProcessTree(entry.child, "SIGKILL");
      } catch (error) {
        entry.state = { status: "failed", error: toError(error) };
        this.flushPendingLogs(serviceId);
        this.appendSystemLog(
          serviceId,
          `failed to force stop service: ${entry.state.error.message}`,
        );
        return entry.state;
      }

      await waitForExit(entry.child, this.forceStopTimeoutMs);
    }

    if (hasLiveChild(entry)) {
      entry.state = { status: "failed", error: new Error("Process did not stop.") };
      this.flushPendingLogs(serviceId);
      this.appendSystemLog(serviceId, "failed to stop service: Process did not stop.");
      return entry.state;
    }

    entry.state = { status: "stopped" };
    return entry.state;
  }

  async restart(service: RunnableConfig): Promise<ManagedProcessState> {
    this.appendSystemLog(service.id, "service restart requested");
    const stoppedState = await this.stop(service.id);

    if (stoppedState.status === "failed") {
      return stoppedState;
    }

    return this.start(service);
  }

  getState(serviceId: string): ManagedProcessState {
    return this.processes.get(serviceId)?.state ?? { status: "stopped" };
  }

  getLogs(serviceId: string): ServiceLogEntry[] {
    return [...(this.logs.get(serviceId) ?? [])];
  }

  async stopAll(): Promise<StopFailure[]> {
    const results = await Promise.all(
      [...this.processes.entries()].map(async ([serviceId, entry]) => {
        if (!hasLiveChild(entry)) {
          return undefined;
        }

        const pid = entry.child.pid;
        const state = await this.stop(serviceId);

        return state.status === "failed" ? { id: serviceId, pid, error: state.error } : undefined;
      }),
    );

    return results.filter((failure) => failure !== undefined);
  }

  private appendLogChunk(
    serviceId: string,
    stream: ProcessOutputStream,
    chunk: Buffer | string,
  ): void {
    const pendingChunk = this.pendingLogChunks.get(serviceId)?.[stream] ?? "";
    const contents = `${pendingChunk}${chunk.toString()}`.replace(/\r\n/g, "\n");
    const lines = contents.split("\n");

    // The unfinished last line stays raw so escape sequences split across chunks
    // are completed by the next chunk.
    const unfinished = collapsePendingLine(lines.pop() ?? "");

    if (unfinished.length > maxUnfinishedLineCharacters) {
      lines.push(unfinished);
      this.setPendingLogChunk(serviceId, stream, undefined);
    } else {
      this.setPendingLogChunk(serviceId, stream, unfinished);
    }

    this.appendLogEntries(serviceId, toSanitizedEntries(stream, lines));
  }

  private setPendingLogChunk(
    serviceId: string,
    stream: ProcessOutputStream,
    value: string | undefined,
  ): void {
    const pendingChunks = this.pendingLogChunks.get(serviceId) ?? {};

    if (value === undefined || value.length === 0) {
      delete pendingChunks[stream];
    } else {
      pendingChunks[stream] = value;
    }

    if (pendingChunks.stdout === undefined && pendingChunks.stderr === undefined) {
      this.pendingLogChunks.delete(serviceId);
      return;
    }

    this.pendingLogChunks.set(serviceId, pendingChunks);
  }

  private flushPendingLogs(serviceId: string): void {
    const pendingChunks = this.pendingLogChunks.get(serviceId);

    if (pendingChunks === undefined) {
      return;
    }

    this.pendingLogChunks.delete(serviceId);
    this.appendLogEntries(
      serviceId,
      (["stdout", "stderr"] as const).flatMap((stream) => {
        const line = pendingChunks[stream];

        return line === undefined ? [] : toSanitizedEntries(stream, [line]);
      }),
    );
  }

  private appendSystemLog(serviceId: string, line: string): void {
    this.appendLogEntries(serviceId, [
      {
        stream: "system",
        line,
        timestamp: new Date(),
      },
    ]);
  }

  private appendLogEntries(serviceId: string, entries: ServiceLogEntry[]): void {
    if (entries.length === 0) {
      return;
    }

    const serviceLogs = this.logs.get(serviceId) ?? [];

    let characters = this.logCharacters.get(serviceId) ?? 0;

    for (const entry of entries) {
      serviceLogs.push(entry);
      characters += entry.line.length;
    }

    // Drop the oldest lines past either cap, but always keep the newest one.
    let dropCount = Math.max(0, serviceLogs.length - this.maxLogLinesPerService);

    for (let index = 0; index < dropCount; index += 1) {
      characters -= serviceLogs[index]?.line.length ?? 0;
    }

    while (characters > this.maxLogCharactersPerService && dropCount < serviceLogs.length - 1) {
      characters -= serviceLogs[dropCount]?.line.length ?? 0;
      dropCount += 1;
    }

    serviceLogs.splice(0, dropCount);

    this.logs.set(serviceId, serviceLogs);
    this.logCharacters.set(serviceId, characters);
  }

  private async stopProcessTree(
    child: ChildProcess,
    signal: NodeJS.Signals,
  ): Promise<void> {
    if (child.pid === undefined) {
      child.kill(signal);
      return;
    }

    try {
      await this.processTreeKiller(child.pid, signal);
    } catch (error) {
      if (!isAlreadyStoppedError(error)) {
        throw error;
      }
    }
  }
}

// Lines that held only control sequences (a screen clear, a cursor move) are dropped.
function toSanitizedEntries(stream: ProcessOutputStream, lines: string[]): ServiceLogEntry[] {
  return lines.flatMap((rawLine) => {
    const line = sanitizeLogLine(rawLine);

    return line === "" && rawLine !== "" ? [] : [{ stream, line, timestamp: new Date() }];
  });
}

// A progress bar can redraw forever without a newline; keep only its latest frame,
// plus a trailing "\r" that may still turn out to be half of "\r\n".
function collapsePendingLine(line: string): string {
  const endsWithReturn = line.endsWith("\r");
  const collapsed = lastCarriageReturnSegment(endsWithReturn ? line.slice(0, -1) : line);

  return endsWithReturn ? `${collapsed}\r` : collapsed;
}

function formatProcessExitMessage(
  exitCode: number | null,
  signal: NodeJS.Signals | null,
): string {
  if (signal !== null) {
    return `process exited with signal ${signal}`;
  }

  return `process exited with code ${exitCode ?? "null"}`;
}

function hasLiveChild(entry: ManagedProcessEntry): boolean {
  return entry.child.exitCode === null && entry.child.signalCode === null;
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

// Children get pipes, not a terminal, so most tools turn color off. Ask for it, unless
// the user opted out with NO_COLOR; their own FORCE_COLOR or service env still wins.
function colorEnvironment(): NodeJS.ProcessEnv {
  return process.env.NO_COLOR === undefined ? { FORCE_COLOR: "1" } : {};
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

function killProcessTree(pid: number, signal: NodeJS.Signals): Promise<void> {
  return new Promise((resolve, reject) => {
    treeKill(pid, signal, (error) => {
      if (error != null) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function isAlreadyStoppedError(error: unknown): boolean {
  const errorCode =
    error instanceof Error && "code" in error ? error.code : undefined;

  return (
    error instanceof Error &&
    (errorCode === "ESRCH" ||
      /no such process/i.test(error.message) ||
      /no running instance/i.test(error.message))
  );
}
