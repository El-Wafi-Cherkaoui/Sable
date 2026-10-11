import { mapDashboardKey, mapHelpKey, mapLogsKey, mapMoveKey } from "../input/keymap.js";
import type { KeyInput } from "../input/terminal-key-input.js";
import type { ManagedProcessState, ServiceLogEntry } from "../process/process-manager.js";
import { getSelectedCommand, getSelectedService, type RuntimeWorkspaceState } from "../runtime/runtime-state.js";
import { renderHelpView, type HelpContext } from "./help-view.js";
import { clampScrollOffset, maxScrollOffset, renderLogsView } from "./logs-view.js";
import { renderStaticDashboard } from "./static-dashboard.js";
import { shouldUseColor } from "./style.js";

export type DashboardCallbackResult =
  | { type: "continue"; message?: string }
  | { type: "exit" };

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
  abortSignal?: AbortSignal;
  screen?: InteractiveDashboardScreen;
  render?: typeof renderStaticDashboard;
  renderLogs?: typeof renderLogsView;
  renderHelp?: typeof renderHelpView;
  dashboardQuitLabel?: string;
  logVisibleLineCount?: number;
  logsRefreshIntervalMs?: number;
  logsRevealIntervalMs?: number;
  onAddService?: () => Promise<DashboardCallbackResult>;
  onEditService?: () => Promise<DashboardCallbackResult>;
  onDeleteService?: () => Promise<DashboardCallbackResult>;
  onMoveServiceUp?: () => Promise<DashboardCallbackResult>;
  onMoveServiceDown?: () => Promise<DashboardCallbackResult>;
};

export type InteractiveDashboardResult = { type: "back" } | { type: "exit" };

type ViewMode = "dashboard" | "logs" | "help" | "move";
type HelpReturnMode = "dashboard" | "logs";
type LoopEvent =
  | { type: "key"; keypress: Awaited<ReturnType<KeyInput["readKey"]>> }
  | { type: "refresh" }
  | { type: "abort" };
type AbortWait = {
  promise: Promise<void>;
  cleanup(): void;
};

export async function runInteractiveDashboard(
  options: RunInteractiveDashboardOptions,
): Promise<InteractiveDashboardResult> {
  const screen = options.screen ?? terminalScreen;
  const color = shouldUseColor();
  let dashboardMessage: string | undefined;
  const render = options.render ?? renderStaticDashboard;
  const renderLogs = options.renderLogs ?? renderLogsView;
  const renderHelp = options.renderHelp ?? renderHelpView;
  const configuredLogVisibleLineCount = options.logVisibleLineCount;
  const logsRefreshIntervalMs = options.logsRefreshIntervalMs ?? 250;
  const logsRevealIntervalMs = options.logsRevealIntervalMs ?? 55;
  let shouldQuit = false;
  let pulseItem: { type: "service"; index: number } | { type: "command"; index: number } | undefined;
  let pulseTimer: ReturnType<typeof setTimeout> | undefined;
  let mode = "dashboard" as ViewMode;
  let helpReturnMode: HelpReturnMode = "dashboard";
  // Net number of positions the service moved in move mode, so Esc can undo it.
  let moveOffset = 0;
  let logScrollOffset = 0;
  let logHorizontalScrollOffset = 0;
  let followLogTail = true;
  let logRevealLineCount: number | undefined;
  let pendingKeyRead: Promise<Awaited<ReturnType<KeyInput["readKey"]>>> | undefined;
  let lastDashboardContents: string | undefined;

  renderDashboardFrame();

  try {
    while (!shouldQuit) {
    const currentMode: ViewMode = mode;
    const refreshIntervalMs = currentMode === "logs" && isLogRevealActive()
      ? logsRevealIntervalMs
      : logsRefreshIntervalMs;
    const event =
      currentMode === "logs" || shouldRefreshDashboardPreview()
        ? await readKeyOrRefresh(refreshIntervalMs)
        : await readKeyOrAbort();

    if (event.type === "abort") {
      return { type: "exit" };
    }

    if (event.type === "key" && isCtrlC(event.keypress)) {
      return { type: "exit" };
    }

    if (currentMode === "move") {
      if (event.type === "refresh") {
        continue;
      }

      const moveResult = await handleMoveKey(event.keypress);

      if (moveResult === "exit") {
        return { type: "exit" };
      }

      continue;
    }

    if (currentMode === "help") {
      if (event.type === "refresh") {
        continue;
      }

      if (mapHelpKey(event.keypress) === "back") {
        clearPulse();
        mode = helpReturnMode;
        renderCurrentMode();
      }

      continue;
    }

    if (currentMode === "logs") {
      if (event.type === "refresh") {
        const logs = options.controller.getSelectedServiceLogs();

        logScrollOffset = followLogTail
          ? maxScrollOffset(logs.length, getLogVisibleLineCount())
          : clampScrollOffset(logScrollOffset, logs.length, getLogVisibleLineCount());
        advanceLogReveal(logs.length);
        renderLogsFrame();
        continue;
      }

      const keypress = event.keypress;
      const action = mapLogsKey(keypress);
      const logs = options.controller.getSelectedServiceLogs();

      switch (action) {
        case "scrollDown":
          clearLogReveal();
          logScrollOffset = clampScrollOffset(
            logScrollOffset + 1,
            logs.length,
            getLogVisibleLineCount(),
          );
          followLogTail = logScrollOffset === maxScrollOffset(logs.length, getLogVisibleLineCount());
          renderLogsFrame();
          break;
        case "scrollUp":
          clearLogReveal();
          logScrollOffset = clampScrollOffset(
            logScrollOffset - 1,
            logs.length,
            getLogVisibleLineCount(),
          );
          followLogTail = false;
          renderLogsFrame();
          break;
        case "scrollTop":
          clearLogReveal();
          logScrollOffset = 0;
          followLogTail = false;
          renderLogsFrame();
          break;
        case "scrollBottom":
          clearLogReveal();
          logScrollOffset = maxScrollOffset(logs.length, getLogVisibleLineCount());
          followLogTail = true;
          renderLogsFrame();
          break;
        case "scrollLeft":
          clearLogReveal();
          logHorizontalScrollOffset = Math.max(0, logHorizontalScrollOffset - 8);
          renderLogsFrame();
          break;
        case "scrollRight":
          clearLogReveal();
          logHorizontalScrollOffset += 8;
          renderLogsFrame();
          break;
        case "resetHorizontalScroll":
          clearLogReveal();
          logHorizontalScrollOffset = 0;
          renderLogsFrame();
          break;
        case "openHelp":
          clearLogReveal();
          helpReturnMode = "logs";
          mode = "help";
          renderHelpFrame("logs");
          break;
        case "back":
          clearPulse();
          clearLogReveal();
          mode = "dashboard";
          renderDashboardFrame();
          break;
        case "none":
          break;
      }

      continue;
    }

    if (event.type === "refresh") {
      clearPulse();
      renderDashboardFrame({ skipUnchanged: true });
      continue;
    }

    const action = mapDashboardKey(event.keypress);

    switch (action) {
      case "selectNext":
        clearDashboardMessage();
        clearPulse();
        options.controller.selectNextService();
        pulseItem = getPulseItem(options.controller.getState());
        schedulePulseClear();
        renderDashboardFrame();
        break;
      case "selectPrevious":
        clearDashboardMessage();
        clearPulse();
        options.controller.selectPreviousService();
        pulseItem = getPulseItem(options.controller.getState());
        schedulePulseClear();
        renderDashboardFrame();
        break;
      case "start":
        clearDashboardMessage();
        clearPulse();
        await options.controller.startSelectedService();
        pulseItem = getPulseItem(options.controller.getState());
        schedulePulseClear();
        renderDashboardFrame();
        break;
      case "toggle":
        clearDashboardMessage();
        clearPulse();
        await (isSelectedItemRunning(options.controller.getState())
          ? options.controller.stopSelectedService()
          : options.controller.startSelectedService());
        pulseItem = getPulseItem(options.controller.getState());
        schedulePulseClear();
        renderDashboardFrame();
        break;
      case "restart":
        clearDashboardMessage();
        clearPulse();
        await options.controller.restartSelectedService();
        pulseItem = getPulseItem(options.controller.getState());
        schedulePulseClear();
        renderDashboardFrame();
        break;
      case "addService": {
        clearPulse();

        if (options.onAddService !== undefined) {
          const result = await options.onAddService();

          if (result.type === "exit") {
            return { type: "exit" };
          }

          dashboardMessage = result.message;
        }

        renderDashboardFrame();
        break;
      }
      case "editService": {
        clearPulse();

        if (options.onEditService !== undefined) {
          const result = await options.onEditService();

          if (result.type === "exit") {
            return { type: "exit" };
          }

          dashboardMessage = result.message;
        }

        renderDashboardFrame();
        break;
      }
      case "deleteService": {
        clearPulse();

        if (options.onDeleteService !== undefined) {
          const result = await options.onDeleteService();

          if (result.type === "exit") {
            return { type: "exit" };
          }

          dashboardMessage = result.message;
        }

        renderDashboardFrame();
        break;
      }
      case "moveServiceUp": {
        clearPulse();

        if (options.onMoveServiceUp !== undefined) {
          const result = await options.onMoveServiceUp();

          if (result.type === "exit") {
            return { type: "exit" };
          }

          dashboardMessage = result.message;
        }

        renderDashboardFrame();
        break;
      }
      case "moveServiceDown": {
        clearPulse();

        if (options.onMoveServiceDown !== undefined) {
          const result = await options.onMoveServiceDown();

          if (result.type === "exit") {
            return { type: "exit" };
          }

          dashboardMessage = result.message;
        }

        renderDashboardFrame();
        break;
      }
      case "openLogs":
        clearDashboardMessage();
        clearPulse();
        mode = "logs";
        followLogTail = true;
        logHorizontalScrollOffset = 0;
        logRevealLineCount = resolveInitialLogRevealLineCount(
          options.controller.getSelectedServiceLogs().length,
          getLogVisibleLineCount(),
        );
        logScrollOffset = maxScrollOffset(
          options.controller.getSelectedServiceLogs().length,
          getLogVisibleLineCount(),
        );
        renderLogsFrame();
        break;
      case "openHelp":
        clearDashboardMessage();
        clearPulse();
        helpReturnMode = "dashboard";
        mode = "help";
        renderHelpFrame("dashboard");
        break;
      case "startMove": {
        clearPulse();
        const state = options.controller.getState();

        if (getSelectedCommand(state) !== undefined) {
          dashboardMessage = "Only services can be moved.";
        } else if (getSelectedService(state) !== undefined && state.services.length > 1) {
          clearDashboardMessage();
          moveOffset = 0;
          mode = "move";
        }

        renderDashboardFrame();
        break;
      }
      case "back":
        clearPulse();
        shouldQuit = true;
        break;
      case "none":
        break;
    }
    }

    return { type: "back" };
  } finally {
    clearPulse();
  }

  function renderLogsFrame(): void {
    const logs = options.controller.getSelectedServiceLogs();

    logScrollOffset = clampScrollOffset(
      logScrollOffset,
      logs.length,
        getLogVisibleLineCount(),
    );
    lastDashboardContents = undefined;
    renderFrame(
      screen,
      renderLogs({
        state: options.controller.getState(),
        logs,
        scrollOffset: logScrollOffset,
        visibleLineCount: getLogVisibleLineCount(),
        revealLineCount: logRevealLineCount,
        horizontalScrollOffset: logHorizontalScrollOffset,
        viewportColumns: process.stdout.columns,
        color,
      }),
    );
  }

  function getLogVisibleLineCount(): number {
    if (configuredLogVisibleLineCount !== undefined) {
      return configuredLogVisibleLineCount;
    }

    const rows = process.stdout.rows;

    if (rows === undefined || rows <= 0) {
      return 12;
    }

    return Math.max(3, rows - 11);
  }

  function isLogRevealActive(): boolean {
    return logRevealLineCount !== undefined;
  }

  function clearLogReveal(): void {
    logRevealLineCount = undefined;
  }

  function advanceLogReveal(logLineCount: number): void {
    if (logRevealLineCount === undefined) {
      return;
    }

    const visibleLogCount = resolveVisibleLogCount(logLineCount, getLogVisibleLineCount());
    const nextRevealLineCount = logRevealLineCount + resolveLogRevealStep(visibleLogCount);

    logRevealLineCount = nextRevealLineCount >= visibleLogCount
      ? undefined
      : nextRevealLineCount;
  }

  function renderHelpFrame(context: HelpContext): void {
    lastDashboardContents = undefined;
    renderFrame(screen, renderHelp(context));
  }

  function renderCurrentMode(): void {
    if (mode === "logs") {
      renderLogsFrame();
      return;
    }

    if (mode === "help") {
      renderHelpFrame(helpReturnMode);
      return;
    }

    renderDashboardFrame();
  }

  function renderDashboardFrame(renderOptions: { skipUnchanged?: boolean } = {}): void {
    const contents = render(options.controller.getState(), {
      quitLabel: options.dashboardQuitLabel,
      moving: mode === "move",
      statusMessage: dashboardMessage,
      pulseServiceIndex: pulseItem?.type === "service" ? pulseItem.index : undefined,
      pulseCommandIndex: pulseItem?.type === "command" ? pulseItem.index : undefined,
      selectedServiceLogs: options.controller.getSelectedServiceLogs(),
      columns: process.stdout.columns,
      rows: process.stdout.rows,
      color,
    });

    if (renderOptions.skipUnchanged === true && contents === lastDashboardContents) {
      return;
    }

    lastDashboardContents = contents;
    renderFrame(screen, contents);
  }

  function shouldRefreshDashboardPreview(): boolean {
    return (mode === "dashboard" || mode === "move") && process.stdout.columns !== undefined && process.stdout.columns >= 100;
  }

  function clearDashboardMessage(): void {
    dashboardMessage = undefined;
  }

  function clearPulse(): void {
    if (pulseTimer !== undefined) {
      clearTimeout(pulseTimer);
      pulseTimer = undefined;
    }

    pulseItem = undefined;
  }

  function schedulePulseClear(): void {
    if (pulseTimer !== undefined) {
      clearTimeout(pulseTimer);
      pulseTimer = undefined;
    }

    pulseTimer = setTimeout(() => {
      if (mode === "dashboard") {
        pulseItem = undefined;
        renderDashboardFrame();
      }
    }, 110);
  }

  async function handleMoveKey(
    keypress: Awaited<ReturnType<KeyInput["readKey"]>>,
  ): Promise<"continue" | "exit"> {
    const action = mapMoveKey(keypress);

    if (action === "moveUp" || action === "moveDown") {
      const moved = await moveSelectedService(action === "moveUp" ? "up" : "down");

      if (moved === "exit") {
        return "exit";
      }

      renderDashboardFrame();
      return "continue";
    }

    if (action === "cancel") {
      while (moveOffset !== 0) {
        const moved = await moveSelectedService(moveOffset > 0 ? "up" : "down");

        if (moved !== "moved") {
          break;
        }
      }
    }

    if (action === "done" || action === "cancel") {
      const serviceName = getSelectedService(options.controller.getState())?.service.name;

      dashboardMessage = action === "done" && moveOffset !== 0 && serviceName !== undefined
        ? `Moved service "${serviceName}".`
        : undefined;
      moveOffset = 0;
      mode = "dashboard";
      renderDashboardFrame();
    }

    return "continue";
  }

  async function moveSelectedService(direction: "up" | "down"): Promise<"moved" | "unchanged" | "exit"> {
    const callback = direction === "up" ? options.onMoveServiceUp : options.onMoveServiceDown;

    if (callback === undefined) {
      return "unchanged";
    }

    const indexBefore = options.controller.getState().selectedServiceIndex;
    const result = await callback();

    if (result.type === "exit") {
      return "exit";
    }

    const indexAfter = options.controller.getState().selectedServiceIndex;

    if (indexBefore === undefined || indexAfter === undefined || indexBefore === indexAfter) {
      return "unchanged";
    }

    moveOffset += indexAfter - indexBefore;
    return "moved";
  }

  async function readKeyEvent(): Promise<Awaited<ReturnType<KeyInput["readKey"]>>> {
    pendingKeyRead ??= options.keyInput.readKey();
    const keypress = await pendingKeyRead;

    pendingKeyRead = undefined;

    return keypress;
  }

  async function readKeyOrRefresh(refreshIntervalMs: number): Promise<LoopEvent> {
    pendingKeyRead ??= options.keyInput.readKey();
    const abortWait = createAbortWait(options.abortSignal);

    const event = await Promise.race([
      pendingKeyRead.then((keypress) => ({ type: "key" as const, keypress })),
      wait(refreshIntervalMs).then(() => ({ type: "refresh" as const })),
      abortWait.promise.then(() => ({ type: "abort" as const })),
    ]).finally(() => abortWait.cleanup());

    if (event.type === "key") {
      pendingKeyRead = undefined;
    }

    return event;
  }

  async function readKeyOrAbort(): Promise<LoopEvent> {
    const abortWait = createAbortWait(options.abortSignal);

    return Promise.race([
      readKeyEvent().then((keypress) => ({ type: "key" as const, keypress })),
      abortWait.promise.then(() => ({ type: "abort" as const })),
    ]).finally(() => abortWait.cleanup());
  }
}

function isCtrlC(keypress: Awaited<ReturnType<KeyInput["readKey"]>>): boolean {
  return keypress.ctrl === true && keypress.name === "c";
}

function createAbortWait(signal: AbortSignal | undefined): AbortWait {
  if (signal === undefined) {
    return {
      promise: new Promise(() => undefined),
      cleanup() {},
    };
  }

  if (signal.aborted) {
    return {
      promise: Promise.resolve(),
      cleanup() {},
    };
  }

  let abortListener: (() => void) | undefined;

  const promise = new Promise<void>((resolve) => {
    abortListener = () => resolve();
    signal.addEventListener("abort", abortListener, { once: true });
  });

  return {
    promise,
    cleanup() {
      if (abortListener !== undefined) {
        signal.removeEventListener("abort", abortListener);
      }
    },
  };
}

function isSelectedItemRunning(state: RuntimeWorkspaceState): boolean {
  const selected = getSelectedCommand(state) ?? getSelectedService(state);

  return selected?.process.status === "running";
}

function getPulseItem(
  state: RuntimeWorkspaceState,
): { type: "service"; index: number } | { type: "command"; index: number } | undefined {
  if (state.selectedItem?.type === "service") {
    return { type: "service", index: state.selectedItem.index };
  }

  if (state.selectedItem?.type === "command") {
    return { type: "command", index: state.selectedItem.index };
  }

  return undefined;
}

function resolveInitialLogRevealLineCount(
  logLineCount: number,
  visibleLineCount: number,
): number | undefined {
  const visibleLogCount = resolveVisibleLogCount(logLineCount, visibleLineCount);

  if (visibleLogCount <= 3) {
    return undefined;
  }

  return Math.max(1, Math.ceil(visibleLogCount / 3));
}

function resolveVisibleLogCount(logLineCount: number, visibleLineCount: number): number {
  return Math.min(logLineCount, visibleLineCount);
}

function resolveLogRevealStep(visibleLogCount: number): number {
  return Math.max(1, Math.ceil(visibleLogCount / 3));
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
    process.stdout.write("\x1b[H");
  },
  write(contents) {
    process.stdout.write(`${clearLineEnds(contents)}\x1b[J`);
  },
};

function clearLineEnds(contents: string): string {
  return contents.replace(/\n/g, "\x1b[K\n");
}
