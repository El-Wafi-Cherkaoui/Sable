import { mapDashboardKey, mapHelpKey, mapLogsKey, mapMoveKey } from "../input/keymap.js";
import type { KeyInput } from "../input/terminal-key-input.js";
import type { ManagedProcessState, ServiceLogEntry } from "../process/process-manager.js";
import { getSelectedCommand, getSelectedService, type RuntimeWorkspaceState } from "../runtime/runtime-state.js";
import type { SoundControl } from "../sound/sound-control.js";
import { runSettingsDialog } from "./settings-dialog.js";
import { renderHelpView, type HelpContext } from "./help-view.js";
import {
  bottomScrollOffset,
  clampScrollOffset,
  errorIndexes,
  findMatches,
  nextIndex,
  renderLogsView,
  type LogsLayout,
  type LogsSearch,
} from "./logs-view.js";
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
  sound?: SoundControl;
  runSettings?: typeof runSettingsDialog;
  dashboardQuitLabel?: string;
  initialMessage?: string;
  logVisibleLineCount?: number;
  logsRefreshIntervalMs?: number;
  logsRevealIntervalMs?: number;
  onAddService?: () => Promise<DashboardCallbackResult>;
  onEditService?: () => Promise<DashboardCallbackResult>;
  onDeleteService?: (context: { background?: string }) => Promise<DashboardCallbackResult>;
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
  let dashboardMessage: string | undefined = options.initialMessage;
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
  let logWrap = false;
  let logSearch: LogsSearch | undefined;
  let logHighlightIndex: number | undefined;
  let logMessage: string | undefined;
  let pendingKeyRead: Promise<Awaited<ReturnType<KeyInput["readKey"]>>> | undefined;
  let lastDashboardContents: string | undefined;
  // The last dashboard or logs frame, shown dimmed behind the help popup.
  let lastScreenContents: string | undefined;

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
      const logs = options.controller.getSelectedServiceLogs();

      if (event.type === "refresh") {
        logScrollOffset = followLogTail
          ? bottomScrollOffset(logs, getLogsLayout())
          : clampScrollOffset(logScrollOffset, logs, getLogsLayout());
        advanceLogReveal(logs.length);
        renderLogsFrame();
        continue;
      }

      const keypress = event.keypress;

      clearLogReveal();
      logMessage = undefined;

      if (logSearch?.editing === true) {
        if (keypress.name === "escape") {
          logSearch = undefined;
        } else if (keypress.name === "return" || keypress.sequence === "\r") {
          logSearch = logSearch.query === "" ? undefined : { query: logSearch.query, editing: false };

          if (logSearch !== undefined) {
            jumpToLogLine(findMatches(logs, logSearch.query).at(-1), logs);
          }
        } else if (keypress.name === "backspace") {
          logSearch = { ...logSearch, query: logSearch.query.slice(0, -1) };
        } else if (keypress.sequence !== undefined && keypress.ctrl !== true && keypress.sequence >= " " && keypress.sequence !== "\x7f") {
          logSearch = { ...logSearch, query: logSearch.query + keypress.sequence };
        }

        renderLogsFrame();
        continue;
      }

      const action = mapLogsKey(keypress);

      switch (action) {
        case "scrollDown":
          logScrollOffset = clampScrollOffset(logScrollOffset + 1, logs, getLogsLayout());
          followLogTail = logScrollOffset === bottomScrollOffset(logs, getLogsLayout());
          break;
        case "scrollUp":
          logScrollOffset = clampScrollOffset(logScrollOffset - 1, logs, getLogsLayout());
          followLogTail = false;
          break;
        case "scrollTop":
          logScrollOffset = 0;
          followLogTail = false;
          break;
        case "scrollBottom":
          logScrollOffset = bottomScrollOffset(logs, getLogsLayout());
          followLogTail = true;
          logHighlightIndex = undefined;
          break;
        case "scrollLeft":
          logHorizontalScrollOffset = Math.max(0, logHorizontalScrollOffset - 8);
          break;
        case "scrollRight":
          logHorizontalScrollOffset += 8;
          break;
        case "resetHorizontalScroll":
          logHorizontalScrollOffset = 0;
          break;
        case "search":
          logSearch = { query: "", editing: true };
          break;
        case "nextMatch":
        case "previousMatch":
          if (logSearch !== undefined) {
            jumpToLogLine(nextIndex(findMatches(logs, logSearch.query), logHighlightIndex, action === "nextMatch" ? 1 : -1), logs);
          }
          break;
        case "nextError": {
          const errorLine = nextIndex(errorIndexes(logs), logHighlightIndex ?? logScrollOffset - 1, 1);

          if (errorLine === undefined) {
            logMessage = "No errors in this output.";
          } else {
            jumpToLogLine(errorLine, logs);
          }
          break;
        }
        case "toggleWrap":
          logWrap = !logWrap;
          logHorizontalScrollOffset = 0;
          if (followLogTail) {
            logScrollOffset = bottomScrollOffset(logs, getLogsLayout());
          }
          break;
        case "openHelp":
          helpReturnMode = "logs";
          mode = "help";
          renderHelpFrame("logs");
          continue;
        case "back":
          if (logSearch !== undefined) {
            logSearch = undefined;
            logHighlightIndex = undefined;
            break;
          }

          clearPulse();
          options.sound?.play("back");
          mode = "dashboard";
          renderDashboardFrame();
          continue;
        case "none":
          continue;
      }

      renderLogsFrame();
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
        options.sound?.play("move");
        pulseItem = getPulseItem(options.controller.getState());
        schedulePulseClear();
        renderDashboardFrame();
        break;
      case "selectPrevious":
        clearDashboardMessage();
        clearPulse();
        options.controller.selectPreviousService();
        options.sound?.play("move");
        pulseItem = getPulseItem(options.controller.getState());
        schedulePulseClear();
        renderDashboardFrame();
        break;
      case "start":
        clearDashboardMessage();
        clearPulse();
        options.sound?.play("started");
        await options.controller.startSelectedService();
        pulseItem = getPulseItem(options.controller.getState());
        schedulePulseClear();
        renderDashboardFrame();
        break;
      case "toggle":
        clearDashboardMessage();
        clearPulse();
        if (isSelectedItemRunning(options.controller.getState())) {
          options.sound?.play("stopped");
          showBusyMessage("Stopping");
          await options.controller.stopSelectedService();
          clearDashboardMessage();
        } else {
          options.sound?.play("started");
          await options.controller.startSelectedService();
        }
        pulseItem = getPulseItem(options.controller.getState());
        schedulePulseClear();
        renderDashboardFrame();
        break;
      case "restart":
        clearDashboardMessage();
        clearPulse();
        if (isSelectedItemRunning(options.controller.getState())) {
          showBusyMessage("Restarting");
        }

        options.sound?.play("started");
        await options.controller.restartSelectedService();
        clearDashboardMessage();
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
          const result = await options.onDeleteService({ background: lastScreenContents });

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
        options.sound?.play("open");
        clearDashboardMessage();
        clearPulse();
        mode = "logs";
        followLogTail = true;
        logHorizontalScrollOffset = 0;
        logSearch = undefined;
        logHighlightIndex = undefined;
        logMessage = undefined;
        logRevealLineCount = resolveInitialLogRevealLineCount(
          options.controller.getSelectedServiceLogs().length,
          getLogVisibleLineCount(),
        );
        logScrollOffset = bottomScrollOffset(options.controller.getSelectedServiceLogs(), getLogsLayout());
        renderLogsFrame();
        break;
      case "openHelp":
        clearDashboardMessage();
        clearPulse();
        helpReturnMode = "dashboard";
        mode = "help";
        renderHelpFrame("dashboard");
        break;
      case "openSettings": {
        if (options.sound === undefined) {
          break;
        }

        clearDashboardMessage();
        clearPulse();

        const outcome = await (options.runSettings ?? runSettingsDialog)({
          sound: options.sound,
          keyInput: options.keyInput,
          background: lastScreenContents,
          screen,
        });

        if (outcome === "exit") {
          return { type: "exit" };
        }

        renderDashboardFrame();
        break;
      }
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
        options.sound?.play("back");
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

    logScrollOffset = clampScrollOffset(logScrollOffset, logs, getLogsLayout());
    lastDashboardContents = undefined;
    lastScreenContents = renderLogs({
        state: options.controller.getState(),
        logs,
        scrollOffset: logScrollOffset,
        following: followLogTail,
        visibleLineCount: getLogVisibleLineCount(),
        revealLineCount: logRevealLineCount,
        horizontalScrollOffset: logHorizontalScrollOffset,
        viewportColumns: process.stdout.columns,
        wrap: logWrap,
        search: logSearch,
        highlightIndex: logHighlightIndex,
        message: logMessage,
        color,
      });
    renderFrame(screen, lastScreenContents);
  }

  function getLogVisibleLineCount(): number {
    if (configuredLogVisibleLineCount !== undefined) {
      return configuredLogVisibleLineCount;
    }

    const rows = process.stdout.rows;

    if (rows === undefined || rows <= 0) {
      return 12;
    }

    // Header, blank, blank, search line, footer, and one row of scroll margin.
    return Math.max(3, rows - 6);
  }

  function getLogsLayout(): LogsLayout {
    return {
      height: getLogVisibleLineCount(),
      width: Math.max(23, (process.stdout.columns ?? 80) - 1),
      wrap: logWrap,
    };
  }

  // Shows a found line a third of the way down, so there is context above and below it.
  function jumpToLogLine(index: number | undefined, logs: ReturnType<typeof options.controller.getSelectedServiceLogs>): void {
    logHighlightIndex = index;

    if (index === undefined) {
      return;
    }

    followLogTail = false;
    logScrollOffset = clampScrollOffset(index - Math.floor(getLogVisibleLineCount() / 3), logs, getLogsLayout());
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
    renderFrame(screen, renderHelp(context, {
      background: lastScreenContents,
      columns: process.stdout.columns,
      rows: process.stdout.rows,
      color,
    }));
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
      settingsAvailable: options.sound !== undefined,
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
    lastScreenContents = contents;
    renderFrame(screen, contents);
  }

  function shouldRefreshDashboardPreview(): boolean {
    return (mode === "dashboard" || mode === "move") && process.stdout.columns !== undefined && process.stdout.columns >= 100;
  }

  // Stopping can take a few seconds while the loop waits, so say what is happening first.
  function showBusyMessage(verb: string): void {
    const selected = getSelectedCommand(options.controller.getState()) ?? getSelectedService(options.controller.getState());
    const name = selected === undefined ? "item" : "command" in selected ? selected.command.name : selected.service.name;

    dashboardMessage = `${verb} ${name}...`;
    renderDashboardFrame();
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

      if (moved === "moved") {
        options.sound?.play("move");
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
