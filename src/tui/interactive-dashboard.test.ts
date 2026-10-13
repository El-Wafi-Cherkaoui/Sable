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
        state = { ...state, selectedItemIndex: 1 };
        return state;
      }),
      selectPreviousService: vi.fn(() => {
        state = { ...state, selectedItemIndex: 0 };
        return state;
      }),
      startSelectedService: vi.fn(async () => ({ status: "running" as const })),
      stopSelectedService: vi.fn(async () => ({ status: "stopped" as const })),
      restartSelectedService: vi.fn(async () => ({ status: "running" as const })),
      getSelectedServiceLogs: vi.fn(() => []),
    };
    const keyInput = createKeyInput([
      { name: "down" },
      { name: "up" },
      { sequence: "q" },
    ]);
    const clear = vi.fn();
    const write = vi.fn();
    const render = vi.fn((runtimeState: RuntimeWorkspaceState) =>
      `selected:${runtimeState.selectedItemIndex}`,
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

  it("briefly pulses the selected row after selection", async () => {
    let state = createState();
    const controller = {
      getState: vi.fn(() => state),
      selectNextService: vi.fn(() => {
        state = {
          ...state,
          selectedItemIndex: 1,
        };

        return state;
      }),
      selectPreviousService: vi.fn(() => state),
      startSelectedService: vi.fn(async () => ({ status: "running" as const })),
      stopSelectedService: vi.fn(async () => ({ status: "stopped" as const })),
      restartSelectedService: vi.fn(async () => ({ status: "running" as const })),
      getSelectedServiceLogs: vi.fn(() => []),
    };
    const keyInput = createControlledKeyInput([{ name: "down" }]);
    const write = vi.fn();
    const runPromise = runInteractiveDashboard({
      controller,
      keyInput,
      screen: { clear: vi.fn(), write },
      render: (runtimeState, renderOptions) =>
        `selected:${runtimeState.selectedItemIndex}:pulse:${renderOptions?.pulseItemIndex ?? "none"}`,
    });

    await waitForWrite(write, "selected:1:pulse:1\n");
    await waitForWrite(write, "selected:1:pulse:none\n");
    keyInput.resolveNext({ ctrl: true, name: "c" });
    await runPromise;
  });

  it("clears pending pulse timers when exiting", async () => {
    let state = createState();
    const controller = {
      getState: vi.fn(() => state),
      selectNextService: vi.fn(() => {
        state = {
          ...state,
          selectedItemIndex: 1,
        };

        return state;
      }),
      selectPreviousService: vi.fn(() => state),
      startSelectedService: vi.fn(async () => ({ status: "running" as const })),
      stopSelectedService: vi.fn(async () => ({ status: "stopped" as const })),
      restartSelectedService: vi.fn(async () => ({ status: "running" as const })),
      getSelectedServiceLogs: vi.fn(() => []),
    };
    const keyInput = createControlledKeyInput([{ name: "down" }]);
    const abortController = new AbortController();
    const write = vi.fn();
    const runPromise = runInteractiveDashboard({
      controller,
      keyInput,
      abortSignal: abortController.signal,
      screen: { clear: vi.fn(), write },
      render: (runtimeState, renderOptions) =>
        `selected:${runtimeState.selectedItemIndex}:pulse:${renderOptions?.pulseItemIndex ?? "none"}`,
    });

    await waitForWrite(write, "selected:1:pulse:1\n");
    abortController.abort();
    await runPromise;
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(write.mock.calls.map(([contents]) => contents)).toEqual([
      "selected:0:pulse:none\n",
      "selected:1:pulse:1\n",
    ]);
  });

  it("passes selected service logs and terminal size to the dashboard renderer", async () => {
    const state = createState();
    const selectedLogs = [
      { stream: "stdout" as const, line: "ready", timestamp: new Date("2026-01-01T00:00:00.000Z") },
    ];
    const controller = createController(state, () => selectedLogs);
    const render = vi.fn(() => "dashboard");

    await runInteractiveDashboard({
      controller,
      keyInput: createKeyInput([{ sequence: "q" }]),
      screen: { clear: vi.fn(), write: vi.fn() },
      render,
    });

    expect(render).toHaveBeenCalledWith(
      state,
      expect.objectContaining({
        selectedServiceLogs: selectedLogs,
        columns: process.stdout.columns,
        rows: process.stdout.rows,
      }),
    );
  });

  it("refreshes the wide dashboard log preview while waiting for input", async () => {
    const originalColumns = process.stdout.columns;
    process.stdout.columns = 120;

    try {
      const state = createState();
      let logs = [
        { stream: "stdout" as const, line: "one", timestamp: new Date() },
      ];
      const controller = createController(state, () => logs);
      const keyInput = createControlledKeyInput([]);
      const write = vi.fn();
      const runPromise = runInteractiveDashboard({
        controller,
        keyInput,
        screen: { clear: vi.fn(), write },
        render: (_state, renderOptions) =>
          `dashboard:${renderOptions?.selectedServiceLogs?.map((entry) => entry.line).join(",") ?? ""}`,
        logsRefreshIntervalMs: 1,
      });

      await waitForWrite(write, "dashboard:one\n");
      logs = [...logs, { stream: "stdout", line: "two", timestamp: new Date() }];
      await waitForWrite(write, "dashboard:one,two\n");
      keyInput.resolveNext({ ctrl: true, name: "c" });
      await runPromise;
    } finally {
      process.stdout.columns = originalColumns;
    }
  });

  it("does not redraw the wide dashboard when preview contents are unchanged", async () => {
    const originalColumns = process.stdout.columns;
    process.stdout.columns = 120;

    try {
      const state = createState();
      const controller = createController(state, () => [
        { stream: "stdout", line: "one", timestamp: new Date() },
      ]);
      const keyInput = createControlledKeyInput([]);
      const write = vi.fn();
      const runPromise = runInteractiveDashboard({
        controller,
        keyInput,
        screen: { clear: vi.fn(), write },
        render: () => "dashboard:one",
        logsRefreshIntervalMs: 1,
      });

      await waitForWrite(write, "dashboard:one\n");
      await new Promise((resolve) => setTimeout(resolve, 20));
      keyInput.resolveNext({ ctrl: true, name: "c" });
      await runPromise;

      expect(write).toHaveBeenCalledTimes(1);
    } finally {
      process.stdout.columns = originalColumns;
    }
  });

  it("quits on Ctrl+C keypress", async () => {
    const state = createState();
    const controller = createController(state, () => []);
    const write = vi.fn();

    await runInteractiveDashboard({
      controller,
      keyInput: createKeyInput([{ name: "c", ctrl: true }]),
      screen: { clear: vi.fn(), write },
      render: () => "dashboard",
    });

    expect(write).toHaveBeenCalledOnce();
  });

  it("quits when aborted while waiting for input", async () => {
    const state = createState();
    const controller = createController(state, () => []);
    const keyInput = createControlledKeyInput([]);
    const abortController = new AbortController();
    const write = vi.fn();
    const runPromise = runInteractiveDashboard({
      controller,
      keyInput,
      abortSignal: abortController.signal,
      screen: { clear: vi.fn(), write },
      render: () => "dashboard",
    });

    await waitForWrite(write, "dashboard\n");
    abortController.abort();
    await runPromise;

    expect(write).toHaveBeenCalledOnce();
  });

  it("removes abort listeners when key input wins the dashboard race", async () => {
    const state = createState();
    const controller = createController(state, () => []);
    const abortController = new AbortController();
    const addAbortListener = vi.spyOn(abortController.signal, "addEventListener");
    const removeAbortListener = vi.spyOn(abortController.signal, "removeEventListener");

    await runInteractiveDashboard({
      controller,
      keyInput: createKeyInput([{ sequence: "x" }, { sequence: "q" }]),
      abortSignal: abortController.signal,
      screen: { clear: vi.fn(), write: vi.fn() },
      render: () => "dashboard",
    });

    expect(addAbortListener).toHaveBeenCalledTimes(2);
    expect(removeAbortListener).toHaveBeenCalledTimes(2);
  });

  it("removes abort listeners when log refresh wins the dashboard race", async () => {
    const state = createState();
    const controller = createController(state, () => []);
    const keyInput = createControlledKeyInput([{ name: "return" }]);
    const abortController = new AbortController();
    const removeAbortListener = vi.spyOn(abortController.signal, "removeEventListener");
    const write = vi.fn();

    const runPromise = runInteractiveDashboard({
      controller,
      keyInput,
      abortSignal: abortController.signal,
      screen: { clear: vi.fn(), write },
      render: () => "dashboard",
      renderLogs: () => "logs",
      logsRefreshIntervalMs: 1,
    });

    await waitForWrite(write, "logs\n");
    await waitUntil(() => removeAbortListener.mock.calls.length >= 2);
    keyInput.resolveNext({ ctrl: true, name: "c" });
    await runPromise;

    expect(removeAbortListener).toHaveBeenCalled();
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
        { sequence: "s" },
        { sequence: "r" },
        { sequence: "q" },
      ]),
      screen: { clear: vi.fn(), write },
      render: () => "dashboard",
    });

    expect(controller.startSelectedService).toHaveBeenCalledOnce();
    expect(controller.stopSelectedService).not.toHaveBeenCalled();
    expect(controller.restartSelectedService).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledTimes(3);
  });

  it("starts everything with S and says so, then keeps redrawing while items start in order", async () => {
    const state = createState();
    let starting = true;
    const controller = {
      ...createController(state, () => []),
      startAll: vi.fn(() => "started" as const),
      isStarting: vi.fn(() => starting),
    };
    const frames: Array<string | undefined> = [];
    const render = vi.fn((_state: RuntimeWorkspaceState, renderOptions?: { statusMessage?: string }) => {
      frames.push(renderOptions?.statusMessage);

      return "dashboard";
    });
    let keysRead = 0;

    await runInteractiveDashboard({
      controller,
      // The refresh timer fires before the next key because the dashboard keeps redrawing while starting.
      keyInput: {
        async readKey() {
          keysRead += 1;

          if (keysRead === 1) {
            return { sequence: "S" };
          }

          await new Promise((resolve) => setTimeout(resolve, 20));
          starting = false;

          return { sequence: "q" };
        },
        close() {},
      },
      screen: { clear: vi.fn(), write: vi.fn() },
      render,
      logsRefreshIntervalMs: 5,
    });

    expect(controller.startAll).toHaveBeenCalledOnce();
    expect(frames).toContain("Starting all services...");
    // More than the first frame, the S frame and nothing else: it redrew on its own while starting.
    expect(render.mock.calls.length).toBeGreaterThan(3);
  });

  it.each([
    ["busy", "Already starting."],
    ["nothing", "No services to start."],
  ] as const)("tells the user when S has nothing to do (%s)", async (outcome, message) => {
    const controller = { ...createController(createState(), () => []), startAll: vi.fn(() => outcome) };
    const frames: Array<string | undefined> = [];

    await runInteractiveDashboard({
      controller,
      keyInput: createKeyInput([{ sequence: "S" }, { sequence: "q" }]),
      screen: { clear: vi.fn(), write: vi.fn() },
      render: (_state, renderOptions) => {
        frames.push(renderOptions?.statusMessage);

        return "dashboard";
      },
    });

    expect(frames).toContain(message);
  });

  it("stops the selected item with s while it is waiting, instead of starting it", async () => {
    const base = createState();
    const state = {
      ...base,
      items: base.items.map((itemState, index) => index === 0 ? { ...itemState, queue: { status: "waiting" as const, for: ["db"] } } : itemState),
    };
    const controller = createController(state, () => []);

    await runInteractiveDashboard({
      controller,
      keyInput: createKeyInput([{ sequence: "s" }, { sequence: "q" }]),
      screen: { clear: vi.fn(), write: vi.fn() },
      render: () => "dashboard",
    });

    expect(controller.stopSelectedService).toHaveBeenCalledOnce();
    expect(controller.startSelectedService).not.toHaveBeenCalled();
  });

  it("passes the reason an item from sable.json failed to the dashboard and to the logs", async () => {
    const base = createState();
    const state = {
      ...base,
      items: base.items.map((itemState, index) => index === 0
        ? { ...itemState, item: { ...itemState.item, fromProject: "backend" }, process: { status: "exited" as const, exitCode: 127, signal: null } }
        : itemState),
    };
    const controller = createController(state, () => [{ stream: "stderr", line: "sh: pnpm: not found", timestamp: new Date(0) }]);
    const dashboardHints: Array<string | undefined> = [];
    const logHints: Array<string | undefined> = [];

    await runInteractiveDashboard({
      controller,
      keyInput: createKeyInput([{ name: "return" }, { name: "escape" }, { sequence: "q" }]),
      screen: { clear: vi.fn(), write: vi.fn() },
      render: (_state, renderOptions) => {
        dashboardHints.push(renderOptions?.failureHint);

        return "dashboard";
      },
      renderLogs: (logsOptions) => {
        logHints.push(logsOptions.hint);

        return "logs";
      },
    });

    expect(dashboardHints[0]).toContain('"pnpm" isn\'t installed here');
    expect(logHints[0]).toContain('"pnpm" isn\'t installed here');
  });

  it("opens the saved logs with L over the dashboard, and carries on after it closes", async () => {
    const onManageSavedLogs = vi.fn(async () => ({ type: "continue" as const }));
    const controller = createController(createState(), () => []);

    await runInteractiveDashboard({
      controller,
      keyInput: createKeyInput([{ sequence: "L" }, { sequence: "q" }]),
      screen: { clear: vi.fn(), write: vi.fn() },
      render: () => "THE DASHBOARD",
      onManageSavedLogs,
    });

    expect(onManageSavedLogs).toHaveBeenCalledWith({ background: "THE DASHBOARD" });
  });

  it("leaves Sable when the saved logs popup was closed with Ctrl+C", async () => {
    const result = await runInteractiveDashboard({
      controller: createController(createState(), () => []),
      keyInput: createKeyInput([{ sequence: "L" }]),
      screen: { clear: vi.fn(), write: vi.fn() },
      render: () => "dashboard",
      onManageSavedLogs: async () => ({ type: "exit" }),
    });

    expect(result).toEqual({ type: "exit" });
  });

  it("says saved logs are not available when nothing can manage them", async () => {
    const messages: Array<string | undefined> = [];

    await runInteractiveDashboard({
      controller: createController(createState(), () => []),
      keyInput: createKeyInput([{ sequence: "L" }, { sequence: "q" }]),
      screen: { clear: vi.fn(), write: vi.fn() },
      render: (_state, renderOptions) => {
        messages.push(renderOptions?.statusMessage);

        return "dashboard";
      },
    });

    expect(messages).toContain("Saved logs are not available here.");
  });

  it("stops a running service with s", async () => {
    const baseState = createState();
    const state = {
      ...baseState,
      items: baseState.items.map((serviceState, index) =>
        index === 0 ? { ...serviceState, process: { status: "running" as const } } : serviceState,
      ),
    };
    const controller = createController(state, () => []);

    await runInteractiveDashboard({
      controller,
      keyInput: createKeyInput([{ sequence: "s" }, { sequence: "q" }]),
      screen: { clear: vi.fn(), write: vi.fn() },
      render: () => "dashboard",
    });

    expect(controller.stopSelectedService).toHaveBeenCalledOnce();
    expect(controller.startSelectedService).not.toHaveBeenCalled();
  });

  it.each([
    ["s", "Stopping backend...", "stopSelectedService"],
    ["r", "Restarting backend...", "restartSelectedService"],
  ] as const)("shows a busy message while %s waits on a running service", async (key, message, method) => {
    const baseState = createState();
    const state = {
      ...baseState,
      items: baseState.items.map((serviceState, index) =>
        index === 0 ? { ...serviceState, process: { status: "running" as const } } : serviceState,
      ),
    };
    const controller = createController(state, () => []);
    const messagesSeenByRenderer: Array<string | undefined> = [];
    let messageDuringWait: string | undefined;

    controller[method] = vi.fn(async () => {
      messageDuringWait = messagesSeenByRenderer.at(-1);
      return { status: "stopped" as const };
    });

    await runInteractiveDashboard({
      controller,
      keyInput: createKeyInput([{ sequence: key }, { sequence: "q" }]),
      screen: { clear: vi.fn(), write: vi.fn() },
      render: (_state, renderOptions) => {
        messagesSeenByRenderer.push(renderOptions?.statusMessage);
        return "dashboard";
      },
    });

    expect(messageDuringWait).toBe(message);
    expect(messagesSeenByRenderer.at(-1)).toBeUndefined();
  });

  it("moves a service in move mode and undoes the move on Escape", async () => {
    let state = createState();
    const controller = { ...createController(state, () => []), getState: vi.fn(() => state) };
    const onMoveServiceDown = vi.fn(async () => {
      state = { ...state, selectedItemIndex: 1 };
      return { type: "continue" as const, message: "moved" };
    });
    const onMoveServiceUp = vi.fn(async () => {
      state = { ...state, selectedItemIndex: 0 };
      return { type: "continue" as const, message: "moved" };
    });
    const render = vi.fn((_state: RuntimeWorkspaceState, renderOptions?: { moving?: boolean }) =>
      renderOptions?.moving === true ? "moving" : "dashboard");

    await runInteractiveDashboard({
      controller,
      keyInput: createKeyInput([{ sequence: "m" }, { name: "down" }, { name: "escape" }, { sequence: "q" }]),
      screen: { clear: vi.fn(), write: vi.fn() },
      render,
      onMoveServiceUp,
      onMoveServiceDown,
    });

    expect(onMoveServiceDown).toHaveBeenCalledOnce();
    expect(onMoveServiceUp).toHaveBeenCalledOnce();
    expect(render.mock.results.map((result) => result.value)).toEqual(["dashboard", "moving", "moving", "dashboard"]);
  });

  it("briefly pulses the selected row after service actions", async () => {
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
    const keyInput = createControlledKeyInput([{ sequence: "s" }]);
    const write = vi.fn();
    const runPromise = runInteractiveDashboard({
      controller,
      keyInput,
      screen: { clear: vi.fn(), write },
      render: (runtimeState, renderOptions) =>
        `selected:${runtimeState.selectedItemIndex}:pulse:${renderOptions?.pulseItemIndex ?? "none"}`,
    });

    await waitForWrite(write, "selected:0:pulse:0\n");
    await waitForWrite(write, "selected:0:pulse:none\n");
    keyInput.resolveNext({ ctrl: true, name: "c" });
    await runPromise;

    expect(controller.startSelectedService).toHaveBeenCalledOnce();
  });

  it("clears the screen and redraws when the terminal is resized", async () => {
    const controller = createController(createState(), () => []);
    const clearAll = vi.fn();
    const write = vi.fn();

    await runInteractiveDashboard({
      controller,
      keyInput: createKeyInput([{ name: "resize" }, { sequence: "q" }]),
      screen: { clear: vi.fn(), clearAll, write },
      render: () => "dashboard",
    });

    expect(clearAll).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledTimes(2);
    expect(controller.selectNextService).not.toHaveBeenCalled();
  });

  it("runs the add service callback from the dashboard", async () => {
    const state = createState();
    const controller = createController(state, () => []);
    const onAddService = vi.fn(async () => ({ type: "continue" as const }));
    const write = vi.fn();

    await runInteractiveDashboard({
      controller,
      keyInput: createKeyInput([{ sequence: "a" }, { sequence: "q" }]),
      screen: { clear: vi.fn(), write },
      render: () => "dashboard",
      onAddService,
    });

    expect(onAddService).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("exits when the add service callback exits", async () => {
    const state = createState();
    const controller = createController(state, () => []);
    const onAddService = vi.fn(async () => ({ type: "exit" as const }));

    await runInteractiveDashboard({
      controller,
      keyInput: createKeyInput([{ sequence: "a" }]),
      screen: { clear: vi.fn(), write: vi.fn() },
      render: () => "dashboard",
      onAddService,
    });

    expect(onAddService).toHaveBeenCalledOnce();
  });

  it("runs the edit service callback from the dashboard", async () => {
    const state = createState();
    const controller = createController(state, () => []);
    const onEditService = vi.fn(async () => ({ type: "continue" as const, message: "Edited." }));
    const writes: string[] = [];

    await runInteractiveDashboard({
      controller,
      keyInput: createKeyInput([{ sequence: "e" }, { sequence: "q" }]),
      screen: { clear: vi.fn(), write: vi.fn((contents: string) => writes.push(contents)) },
      onEditService,
    });

    expect(onEditService).toHaveBeenCalledOnce();
    expect(writes.join("\n")).toContain("Edited.");
  });

  it("clears transient dashboard messages when the user navigates", async () => {
    const state = createState();
    const controller = createController(state, () => []);
    const onEditService = vi.fn(async () => ({ type: "continue" as const, message: "Cannot edit while running." }));
    const write = vi.fn();

    await runInteractiveDashboard({
      controller,
      keyInput: createKeyInput([{ sequence: "e" }, { name: "down" }, { sequence: "q" }]),
      screen: { clear: vi.fn(), write },
      render: (_state, renderOptions) => `status:${renderOptions?.statusMessage ?? ""}`,
      onEditService,
    });

    expect(write).toHaveBeenNthCalledWith(2, "status:Cannot edit while running.\n");
    expect(write).toHaveBeenNthCalledWith(3, "status:\n");
  });

  it("runs the delete service callback from the dashboard", async () => {
    const state = createState();
    const controller = createController(state, () => []);
    const onDeleteService = vi.fn(async () => ({ type: "continue" as const, message: "Deleted." }));
    const writes: string[] = [];

    await runInteractiveDashboard({
      controller,
      keyInput: createKeyInput([{ sequence: "d" }, { sequence: "q" }]),
      screen: { clear: vi.fn(), write: vi.fn((contents: string) => writes.push(contents)) },
      onDeleteService,
    });

    expect(onDeleteService).toHaveBeenCalledOnce();
    expect(writes.join("\n")).toContain("Deleted.");
  });

  it("exits when the delete service callback exits", async () => {
    const state = createState();
    const controller = createController(state, () => []);
    const onDeleteService = vi.fn(async () => ({ type: "exit" as const }));

    await runInteractiveDashboard({
      controller,
      keyInput: createKeyInput([{ sequence: "d" }]),
      screen: { clear: vi.fn(), write: vi.fn() },
      render: () => "dashboard",
      onDeleteService,
    });

    expect(onDeleteService).toHaveBeenCalledOnce();
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

  it("closes dashboard help with q", async () => {
    const state = createState();
    const controller = createController(state, () => []);
    const write = vi.fn();

    await runInteractiveDashboard({
      controller,
      keyInput: createKeyInput([{ sequence: "?" }, { sequence: "q" }, { sequence: "q" }]),
      screen: { clear: vi.fn(), write },
      render: () => "dashboard",
      renderHelp: (context) => `help:${context}`,
    });

    expect(write).toHaveBeenCalledTimes(3);
    expect(write).toHaveBeenNthCalledWith(2, "help:dashboard\n");
    expect(write).toHaveBeenNthCalledWith(3, "dashboard\n");
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
        { name: "up" },
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

  it("horizontally scrolls logs and resets the offset", async () => {
    const state = createState();
    const controller = createController(state, () => [
      { stream: "stdout", line: "abcdefghijklmnopqrstuvwxyz", timestamp: new Date() },
    ]);
    const write = vi.fn();

    await runInteractiveDashboard({
      controller,
      keyInput: createKeyInput([
        { name: "return" },
        { name: "right" },
        { name: "left" },
        { sequence: "0" },
        { ctrl: true, name: "c" },
      ]),
      screen: { clear: vi.fn(), write },
      render: () => "dashboard",
      renderLogs: ({ horizontalScrollOffset }) => `logs:${horizontalScrollOffset ?? 0}`,
      logVisibleLineCount: 1,
    });

    expect(write).toHaveBeenNthCalledWith(2, "logs:0\n");
    expect(write).toHaveBeenNthCalledWith(3, "logs:8\n");
    expect(write).toHaveBeenNthCalledWith(4, "logs:0\n");
    expect(write).toHaveBeenNthCalledWith(5, "logs:0\n");
  });
  it("reveals logs in quick batches when opening the logs view", async () => {
    const state = createState();
    const logs = [
      { stream: "stdout" as const, line: "one", timestamp: new Date() },
      { stream: "stdout" as const, line: "two", timestamp: new Date() },
      { stream: "stdout" as const, line: "three", timestamp: new Date() },
      { stream: "stdout" as const, line: "four", timestamp: new Date() },
      { stream: "stdout" as const, line: "five", timestamp: new Date() },
      { stream: "stdout" as const, line: "six", timestamp: new Date() },
    ];
    const controller = createController(state, () => logs);
    const keyInput = createControlledKeyInput([{ name: "return" }]);
    const write = vi.fn();
    const runPromise = runInteractiveDashboard({
      controller,
      keyInput,
      screen: { clear: vi.fn(), write },
      render: () => "dashboard",
      renderLogs: ({ revealLineCount }) => `logs:${revealLineCount ?? "all"}`,
      logVisibleLineCount: 6,
      logsRevealIntervalMs: 1,
    });

    await waitForWrite(write, "logs:2\n");
    await waitForWrite(write, "logs:4\n");
    await waitForWrite(write, "logs:all\n");
    keyInput.resolveNext({ ctrl: true, name: "c" });
    await runPromise;
  });

  it("sizes logs so the footer uses the same terminal safety margin as dashboard pages", async () => {
    const rowsDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "rows");
    Object.defineProperty(process.stdout, "rows", { configurable: true, value: 18 });
    const state = createState();
    const controller = createController(state, () => []);
    const write = vi.fn();

    try {
      await runInteractiveDashboard({
        controller,
        keyInput: createKeyInput([{ name: "return" }, { ctrl: true, name: "c" }]),
        screen: { clear: vi.fn(), write },
        render: () => "dashboard",
      });
    } finally {
      if (rowsDescriptor === undefined) {
        delete (process.stdout as { rows?: number }).rows;
      } else {
        Object.defineProperty(process.stdout, "rows", rowsDescriptor);
      }
    }

    const logsFrame = String(write.mock.calls[1]![0]);

    // 18 rows: the frame fills 17, leaving the last row as scroll margin.
    expect(logsFrame.replace(/\n$/, "").split("\n")).toHaveLength(17);
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
        { ctrl: true, name: "c" },
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
    keyInput.resolveNext({ ctrl: true, name: "c" });
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
    const keyInput = createControlledKeyInput([{ name: "return" }, { name: "up" }]);
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
    keyInput.resolveNext({ ctrl: true, name: "c" });
    await runPromise;
  });
  it("plays cues for moving, starting, stopping, opening and going back", async () => {
    const state = createState();
    const controller = createController(state, () => []);
    const sound = { play: vi.fn(), isEnabled: () => true, setEnabled: vi.fn(async () => {}) };

    await runInteractiveDashboard({
      controller,
      keyInput: createKeyInput([{ name: "down" }, { sequence: "s" }, { name: "return" }, { name: "escape" }, { sequence: "q" }]),
      screen: { clear: vi.fn(), write: vi.fn() },
      sound,
      render: () => "dashboard",
      renderLogs: () => "logs",
    });

    expect(sound.play.mock.calls.map(([cue]) => cue)).toEqual(["move", "started", "open", "back", "back"]);
  });

  it("plays the stop tone before the stop finishes", async () => {
    const base = createState();
    const state: RuntimeWorkspaceState = {
      ...base,
      items: base.items.map((service, index) => index === 0
        ? { ...service, process: { status: "running" as const, pid: 1 } }
        : service),
    };
    let finishStop: () => void = () => {};
    const controller = {
      ...createController(state, () => []),
      stopSelectedService: vi.fn(() => new Promise<{ status: "stopped" }>((resolve) => {
        finishStop = () => resolve({ status: "stopped" });
      })),
    };
    const sound = { play: vi.fn(), isEnabled: () => true, setEnabled: vi.fn(async () => {}) };

    const run = runInteractiveDashboard({
      controller,
      keyInput: createKeyInput([{ sequence: "s" }, { sequence: "q" }]),
      screen: { clear: vi.fn(), write: vi.fn() },
      sound,
      render: () => "dashboard",
    });

    await waitUntil(() => controller.stopSelectedService.mock.calls.length > 0);
    expect(sound.play).toHaveBeenCalledWith("stopped");

    finishStop();
    await run;
  });

  it("opens settings with a comma and returns to the dashboard", async () => {
    const controller = createController(createState(), () => []);
    const settings = fakeSettings();
    const runSettings = vi.fn(async () => "close" as const);
    const write = vi.fn();

    await runInteractiveDashboard({
      controller,
      keyInput: createKeyInput([{ sequence: "," }, { sequence: "q" }]),
      screen: { clear: vi.fn(), write },
      settings,
      runSettings,
      render: () => "dashboard",
    });

    expect(runSettings).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledTimes(2);
  });
});

const toggle = (enabled = true) => {
  let on = enabled;

  return { isEnabled: () => on, setEnabled: vi.fn(async (next: boolean) => { on = next; }) };
};
const fakeSettings = () => ({ sound: { play: vi.fn(), close: vi.fn(), ...toggle() }, welcomeScreen: toggle(), persistLogs: toggle(), tips: toggle() });

function createKeyInput(
  keys: Array<{ sequence?: string; name?: string; ctrl?: boolean }>,
): KeyInput {
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

function createControlledKeyInput(
  initialKeys: Array<{ sequence?: string; name?: string; ctrl?: boolean }>,
) {
  let resolver:
    | ((key: { sequence?: string; name?: string; ctrl?: boolean }) => void)
    | undefined;

  return {
    async readKey() {
      const key = initialKeys.shift();

      if (key !== undefined) {
        return key;
      }

      return new Promise<{ sequence?: string; name?: string; ctrl?: boolean }>((resolve) => {
        resolver = resolve;
      });
    },
    resolveNext(key: { sequence?: string; name?: string; ctrl?: boolean }) {
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
    projectDirectory: process.cwd(),
    items: [
      {
        kind: "service", after: [],
        id: "svc_backend",
        name: "backend",
        command: "npm run dev",
        cwd: ".",
        autoStart: true,
        env: {},
      },
      {
        kind: "service", after: [],
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
