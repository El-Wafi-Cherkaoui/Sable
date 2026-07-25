import { describe, expect, it, vi } from "vitest";
import type { KeyInput } from "../input/terminal-key-input.js";
import { createRuntimeState } from "../runtime/runtime-state.js";
import type { RuntimeWorkspaceState } from "../runtime/runtime-state.js";
import { runInteractiveDashboard } from "./interactive-dashboard.js";

describe("runInteractiveDashboard", () => {
  it("renders, handles selection keys, and quits", async () => {
    let state = createState();
    const controller = {
      getState: vi.fn(() => state),
      selectNextService: vi.fn(() => {
        state = { ...state, selectedServiceIndex: 1 };
        return state;
      }),
      selectPreviousService: vi.fn(() => {
        state = { ...state, selectedServiceIndex: 0 };
        return state;
      }),
      startSelectedService: vi.fn(async () => ({ status: "running" as const })),
      stopSelectedService: vi.fn(async () => ({ status: "stopped" as const })),
      restartSelectedService: vi.fn(async () => ({ status: "running" as const })),
      getSelectedServiceLogs: vi.fn(() => []),
    };
    const keyInput = createKeyInput([
      { sequence: "j" },
      { sequence: "k" },
      { sequence: "q" },
    ]);
    const clear = vi.fn();
    const write = vi.fn();
    const render = vi.fn((runtimeState: RuntimeWorkspaceState) =>
      `selected:${runtimeState.selectedServiceIndex}`,
    );

    await runInteractiveDashboard({
      controller,
      keyInput,
      screen: { clear, write },
      render,
    });

    expect(controller.selectNextService).toHaveBeenCalledOnce();
    expect(controller.selectPreviousService).toHaveBeenCalledOnce();
    expect(clear).toHaveBeenCalledTimes(3);
    expect(write).toHaveBeenNthCalledWith(1, "selected:0\n");
    expect(write).toHaveBeenNthCalledWith(2, "selected:1\n");
    expect(write).toHaveBeenNthCalledWith(3, "selected:0\n");
  });

  it("ignores unknown keys without re-rendering", async () => {
    const state = createState();
    const controller = {
      getState: vi.fn(() => state),
      selectNextService: vi.fn(() => state),
      selectPreviousService: vi.fn(() => state),
      startSelectedService: vi.fn(async () => ({ status: "running" as const })),
      stopSelectedService: vi.fn(async () => ({ status: "stopped" as const })),
      restartSelectedService: vi.fn(async () => ({ status: "running" as const })),
      getSelectedServiceLogs: vi.fn(() => []),
    };
    const write = vi.fn();

    await runInteractiveDashboard({
      controller,
      keyInput: createKeyInput([{ sequence: "x" }, { sequence: "q" }]),
      screen: { clear: vi.fn(), write },
      render: () => "dashboard",
    });

    expect(controller.selectNextService).not.toHaveBeenCalled();
    expect(controller.selectPreviousService).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("runs selected service actions and re-renders after each action", async () => {
    const state = createState();
    const controller = {
      getState: vi.fn(() => state),
      selectNextService: vi.fn(() => state),
      selectPreviousService: vi.fn(() => state),
      startSelectedService: vi.fn(async () => ({ status: "running" as const })),
      stopSelectedService: vi.fn(async () => ({ status: "stopped" as const })),
      restartSelectedService: vi.fn(async () => ({ status: "running" as const })),
      getSelectedServiceLogs: vi.fn(() => []),
    };
    const write = vi.fn();

    await runInteractiveDashboard({
      controller,
      keyInput: createKeyInput([
        { sequence: "S" },
        { sequence: "s" },
        { sequence: "r" },
        { sequence: "q" },
      ]),
      screen: { clear: vi.fn(), write },
      render: () => "dashboard",
    });

    expect(controller.startSelectedService).toHaveBeenCalledOnce();
    expect(controller.stopSelectedService).toHaveBeenCalledOnce();
    expect(controller.restartSelectedService).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledTimes(4);
  });

  it("opens help from dashboard and returns to dashboard", async () => {
    const state = createState();
    const controller = createController(state, () => []);
    const write = vi.fn();

    await runInteractiveDashboard({
      controller,
      keyInput: createKeyInput([
        { sequence: "?" },
        { name: "escape" },
        { sequence: "q" },
      ]),
      screen: { clear: vi.fn(), write },
      render: () => "dashboard",
      renderHelp: (context) => `help:${context}`,
    });

    expect(write).toHaveBeenNthCalledWith(1, "dashboard\n");
    expect(write).toHaveBeenNthCalledWith(2, "help:dashboard\n");
    expect(write).toHaveBeenNthCalledWith(3, "dashboard\n");
  });

  it("quits from dashboard help", async () => {
    const state = createState();
    const controller = createController(state, () => []);
    const write = vi.fn();

    await runInteractiveDashboard({
      controller,
      keyInput: createKeyInput([{ sequence: "?" }, { sequence: "q" }]),
      screen: { clear: vi.fn(), write },
      render: () => "dashboard",
      renderHelp: (context) => `help:${context}`,
    });

    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenNthCalledWith(2, "help:dashboard\n");
  });

  it("opens logs, scrolls, returns to dashboard, and quits", async () => {
    const state = createState();
    const controller = {
      getState: vi.fn(() => state),
      selectNextService: vi.fn(() => state),
      selectPreviousService: vi.fn(() => state),
      startSelectedService: vi.fn(async () => ({ status: "running" as const })),
      stopSelectedService: vi.fn(async () => ({ status: "stopped" as const })),
      restartSelectedService: vi.fn(async () => ({ status: "running" as const })),
      getSelectedServiceLogs: vi.fn(() => [
        { stream: "stdout" as const, line: "one", timestamp: new Date() },
        { stream: "stdout" as const, line: "two", timestamp: new Date() },
        { stream: "stderr" as const, line: "three", timestamp: new Date() },
      ]),
    };
    const write = vi.fn();

    await runInteractiveDashboard({
      controller,
      keyInput: createKeyInput([
        { name: "return" },
        { sequence: "k" },
        { sequence: "g" },
        { sequence: "G" },
        { name: "escape" },
        { sequence: "q" },
      ]),
      screen: { clear: vi.fn(), write },
      render: () => "dashboard",
      renderLogs: ({ scrollOffset }) => `logs:${scrollOffset}`,
      logVisibleLineCount: 2,
    });

    expect(write).toHaveBeenNthCalledWith(1, "dashboard\n");
    expect(write).toHaveBeenNthCalledWith(2, "logs:1\n");
    expect(write).toHaveBeenNthCalledWith(3, "logs:0\n");
    expect(write).toHaveBeenNthCalledWith(4, "logs:0\n");
    expect(write).toHaveBeenNthCalledWith(5, "logs:1\n");
    expect(write).toHaveBeenNthCalledWith(6, "dashboard\n");
  });

  it("opens help from logs and returns to logs", async () => {
    const state = createState();
    const controller = createController(state, () => [
      { stream: "stdout", line: "one", timestamp: new Date() },
    ]);
    const write = vi.fn();

    await runInteractiveDashboard({
      controller,
      keyInput: createKeyInput([
        { name: "return" },
        { sequence: "?" },
        { name: "escape" },
        { sequence: "q" },
      ]),
      screen: { clear: vi.fn(), write },
      render: () => "dashboard",
      renderLogs: ({ scrollOffset }) => `logs:${scrollOffset}`,
      renderHelp: (context) => `help:${context}`,
      logVisibleLineCount: 2,
    });

    expect(write).toHaveBeenNthCalledWith(1, "dashboard\n");
    expect(write).toHaveBeenNthCalledWith(2, "logs:0\n");
    expect(write).toHaveBeenNthCalledWith(3, "help:logs\n");
    expect(write).toHaveBeenNthCalledWith(4, "logs:0\n");
  });

  it("auto-refreshes logs while following the bottom", async () => {
    const state = createState();
    let logs = [
      { stream: "stdout" as const, line: "one", timestamp: new Date() },
      { stream: "stdout" as const, line: "two", timestamp: new Date() },
    ];
    const controller = createController(state, () => logs);
    const keyInput = createControlledKeyInput([{ name: "return" }]);
    const write = vi.fn();
    const runPromise = runInteractiveDashboard({
      controller,
      keyInput,
      screen: { clear: vi.fn(), write },
      render: () => "dashboard",
      renderLogs: ({ scrollOffset }) => `logs:${scrollOffset}`,
      logVisibleLineCount: 2,
      logsRefreshIntervalMs: 1,
    });

    await waitForWrite(write, "logs:0\n");
    logs = [...logs, { stream: "stderr", line: "three", timestamp: new Date() }];
    await waitForWrite(write, "logs:1\n");
    keyInput.resolveNext({ sequence: "q" });
    await runPromise;
  });

  it("keeps the current scroll position on refresh after scrolling up", async () => {
    const state = createState();
    let logs = [
      { stream: "stdout" as const, line: "one", timestamp: new Date() },
      { stream: "stdout" as const, line: "two", timestamp: new Date() },
      { stream: "stdout" as const, line: "three", timestamp: new Date() },
      { stream: "stdout" as const, line: "four", timestamp: new Date() },
    ];
    const controller = createController(state, () => logs);
    const keyInput = createControlledKeyInput([{ name: "return" }, { sequence: "k" }]);
    const write = vi.fn();
    const runPromise = runInteractiveDashboard({
      controller,
      keyInput,
      screen: { clear: vi.fn(), write },
      render: () => "dashboard",
      renderLogs: ({ scrollOffset }) => `logs:${scrollOffset}`,
      logVisibleLineCount: 2,
      logsRefreshIntervalMs: 1,
    });

    await waitForWrite(write, "logs:1\n");
    logs = [...logs, { stream: "stderr", line: "five", timestamp: new Date() }];
    await waitForRepeatedWrite(write, "logs:1\n", 2);
    keyInput.resolveNext({ sequence: "q" });
    await runPromise;
  });
});

function createKeyInput(keys: Array<{ sequence?: string; name?: string }>): KeyInput {
  return {
    async readKey() {
      const key = keys.shift();

      if (key === undefined) {
        throw new Error("No key was provided for this test.");
      }

      return key;
    },
    close() {},
  };
}

function createControlledKeyInput(initialKeys: Array<{ sequence?: string; name?: string }>) {
  let resolver: ((key: { sequence?: string; name?: string }) => void) | undefined;

  return {
    async readKey() {
      const key = initialKeys.shift();

      if (key !== undefined) {
        return key;
      }

      return new Promise<{ sequence?: string; name?: string }>((resolve) => {
        resolver = resolve;
      });
    },
    resolveNext(key: { sequence?: string; name?: string }) {
      if (resolver === undefined) {
        throw new Error("No pending key read.");
      }

      resolver(key);
      resolver = undefined;
    },
    close() {},
  };
}

function createController(
  state: RuntimeWorkspaceState,
  getLogs: () => Array<{
    stream: "stdout" | "stderr" | "system";
    line: string;
    timestamp: Date;
  }>,
) {
  return {
    getState: vi.fn(() => state),
    selectNextService: vi.fn(() => state),
    selectPreviousService: vi.fn(() => state),
    startSelectedService: vi.fn(async () => ({ status: "running" as const })),
    stopSelectedService: vi.fn(async () => ({ status: "stopped" as const })),
    restartSelectedService: vi.fn(async () => ({ status: "running" as const })),
    getSelectedServiceLogs: vi.fn(getLogs),
  };
}

async function waitForWrite(
  write: ReturnType<typeof vi.fn>,
  expectedContents: string,
): Promise<void> {
  await waitUntil(() =>
    write.mock.calls.some(([contents]) => contents === expectedContents),
  );
}

async function waitForRepeatedWrite(
  write: ReturnType<typeof vi.fn>,
  expectedContents: string,
  count: number,
): Promise<void> {
  await waitUntil(
    () =>
      write.mock.calls.filter(([contents]) => contents === expectedContents).length >= count,
  );
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;

  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  expect(predicate()).toBe(true);
}

function createState(): RuntimeWorkspaceState {
  return createRuntimeState({
    id: "ws_ecommerce",
    name: "ecommerce",
    services: [
      {
        id: "svc_backend",
        name: "backend",
        command: "npm run dev",
        cwd: ".",
        autoStart: true,
        env: {},
      },
      {
        id: "svc_frontend",
        name: "frontend",
        command: "npm run dev",
        cwd: ".",
        autoStart: true,
        env: {},
      },
    ],
  });
}
