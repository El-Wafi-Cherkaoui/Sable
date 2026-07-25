import { mapDashboardKey, mapLogsKey } from "../input/keymap.js";
import type { KeyInput } from "../input/terminal-key-input.js";
import type { ManagedProcessState, ServiceLogEntry } from "../process/process-manager.js";
import type { RuntimeWorkspaceState } from "../runtime/runtime-state.js";
import { clampScrollOffset, maxScrollOffset, renderLogsView } from "./logs-view.js";
import { renderStaticDashboard } from "./static-dashboard.js";

export type InteractiveDashboardController = {
  getState(): RuntimeWorkspaceState;
  selectNextService(): RuntimeWorkspaceState;
  selectPreviousService(): RuntimeWorkspaceState;
  startSelectedService(): Promise<ManagedProcessState>;
  stopSelectedService(): Promise<ManagedProcessState>;
  restartSelectedService(): Promise<ManagedProcessState>;
  getSelectedServiceLogs(): ServiceLogEntry[];
};

export type InteractiveDashboardScreen = {
  clear(): void;
  write(contents: string): void;
};

export type RunInteractiveDashboardOptions = {
  controller: InteractiveDashboardController;
  keyInput: KeyInput;
  screen?: InteractiveDashboardScreen;
  render?: typeof renderStaticDashboard;
  renderLogs?: typeof renderLogsView;
  logVisibleLineCount?: number;
  logsRefreshIntervalMs?: number;
};

type ViewMode = "dashboard" | "logs";
type LoopEvent = { type: "key"; keypress: Awaited<ReturnType<KeyInput["readKey"]>> } | { type: "refresh" };

export async function runInteractiveDashboard(
  options: RunInteractiveDashboardOptions,
): Promise<void> {
  const screen = options.screen ?? terminalScreen;
  const render = options.render ?? renderStaticDashboard;
  const renderLogs = options.renderLogs ?? renderLogsView;
  const logVisibleLineCount = options.logVisibleLineCount ?? 20;
  const logsRefreshIntervalMs = options.logsRefreshIntervalMs ?? 250;
  let shouldQuit = false;
  let mode: ViewMode = "dashboard";
  let logScrollOffset = 0;
  let followLogTail = true;
  let pendingKeyRead: Promise<Awaited<ReturnType<KeyInput["readKey"]>>> | undefined;

  renderFrame(screen, render(options.controller.getState()));

  while (!shouldQuit) {
    const event =
      mode === "logs"
        ? await readKeyOrRefresh(logsRefreshIntervalMs)
        : { type: "key" as const, keypress: await readKeyEvent() };

    if (mode === "logs") {
      if (event.type === "refresh") {
        const logs = options.controller.getSelectedServiceLogs();

        logScrollOffset = followLogTail
          ? maxScrollOffset(logs.length, logVisibleLineCount)
          : clampScrollOffset(logScrollOffset, logs.length, logVisibleLineCount);
        renderLogsFrame();
        continue;
      }

      const keypress = event.keypress;
      const action = mapLogsKey(keypress);
      const logs = options.controller.getSelectedServiceLogs();

      switch (action) {
        case "scrollDown":
          logScrollOffset = clampScrollOffset(
            logScrollOffset + 1,
            logs.length,
            logVisibleLineCount,
          );
          followLogTail = logScrollOffset === maxScrollOffset(logs.length, logVisibleLineCount);
          renderLogsFrame();
          break;
        case "scrollUp":
          logScrollOffset = clampScrollOffset(
            logScrollOffset - 1,
            logs.length,
            logVisibleLineCount,
          );
          followLogTail = false;
          renderLogsFrame();
          break;
        case "scrollTop":
          logScrollOffset = 0;
          followLogTail = false;
          renderLogsFrame();
          break;
        case "scrollBottom":
          logScrollOffset = maxScrollOffset(logs.length, logVisibleLineCount);
          followLogTail = true;
          renderLogsFrame();
          break;
        case "back":
          mode = "dashboard";
          renderFrame(screen, render(options.controller.getState()));
          break;
        case "quit":
          shouldQuit = true;
          break;
        case "none":
          break;
      }

      continue;
    }

    if (event.type === "refresh") {
      continue;
    }

    const action = mapDashboardKey(event.keypress);

    switch (action) {
      case "selectNext":
        options.controller.selectNextService();
        renderFrame(screen, render(options.controller.getState()));
        break;
      case "selectPrevious":
        options.controller.selectPreviousService();
        renderFrame(screen, render(options.controller.getState()));
        break;
      case "start":
        await options.controller.startSelectedService();
        renderFrame(screen, render(options.controller.getState()));
        break;
      case "stop":
        await options.controller.stopSelectedService();
        renderFrame(screen, render(options.controller.getState()));
        break;
      case "restart":
        await options.controller.restartSelectedService();
        renderFrame(screen, render(options.controller.getState()));
        break;
      case "openLogs":
        mode = "logs";
        followLogTail = true;
        logScrollOffset = maxScrollOffset(
          options.controller.getSelectedServiceLogs().length,
          logVisibleLineCount,
        );
        renderLogsFrame();
        break;
      case "quit":
        shouldQuit = true;
        break;
      case "none":
        break;
    }
  }

  function renderLogsFrame(): void {
    const logs = options.controller.getSelectedServiceLogs();

    logScrollOffset = clampScrollOffset(
      logScrollOffset,
      logs.length,
      logVisibleLineCount,
    );
    renderFrame(
      screen,
      renderLogs({
        state: options.controller.getState(),
        logs,
        scrollOffset: logScrollOffset,
        visibleLineCount: logVisibleLineCount,
      }),
    );
  }

  async function readKeyEvent(): Promise<Awaited<ReturnType<KeyInput["readKey"]>>> {
    pendingKeyRead ??= options.keyInput.readKey();
    const keypress = await pendingKeyRead;

    pendingKeyRead = undefined;

    return keypress;
  }

  async function readKeyOrRefresh(refreshIntervalMs: number): Promise<LoopEvent> {
    pendingKeyRead ??= options.keyInput.readKey();

    const event = await Promise.race([
      pendingKeyRead.then((keypress) => ({ type: "key" as const, keypress })),
      wait(refreshIntervalMs).then(() => ({ type: "refresh" as const })),
    ]);

    if (event.type === "key") {
      pendingKeyRead = undefined;
    }

    return event;
  }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function renderFrame(screen: InteractiveDashboardScreen, contents: string): void {
  screen.clear();
  screen.write(`${contents}\n`);
}

const terminalScreen: InteractiveDashboardScreen = {
  clear() {
    process.stdout.write("\x1b[2J\x1b[H");
  },
  write(contents) {
    process.stdout.write(contents);
  },
};
