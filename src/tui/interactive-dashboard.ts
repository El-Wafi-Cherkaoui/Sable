import { mapDashboardKey, mapHelpKey, mapLogsKey } from "../input/keymap.js";
import type { KeyInput } from "../input/terminal-key-input.js";
import type { ManagedProcessState, ServiceLogEntry } from "../process/process-manager.js";
import type { RuntimeWorkspaceState } from "../runtime/runtime-state.js";
import { parseCommand, renderCommandView } from "./command-view.js";
import { renderHelpView, type HelpContext } from "./help-view.js";
import { clampScrollOffset, maxScrollOffset, renderLogsView } from "./logs-view.js";
import { renderStaticDashboard } from "./static-dashboard.js";
import { shouldUseColor } from "./style.js";

type DashboardCallbackResult =
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
  renderCommand?: typeof renderCommandView;
  dashboardQuitLabel?: string;
  logVisibleLineCount?: number;
  logsRefreshIntervalMs?: number;
  onAddService?: () => Promise<DashboardCallbackResult>;
  onEditService?: () => Promise<DashboardCallbackResult>;
  onDeleteService?: () => Promise<DashboardCallbackResult>;
  onMoveServiceUp?: () => Promise<DashboardCallbackResult>;
  onMoveServiceDown?: () => Promise<DashboardCallbackResult>;
};

export type InteractiveDashboardResult = { type: "back" } | { type: "exit" };

type ViewMode = "dashboard" | "logs" | "help" | "command";
type HelpReturnMode = "dashboard" | "logs";
type CommandReturnMode = ViewMode;
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
  const renderCommand = options.renderCommand ?? renderCommandView;
  const configuredLogVisibleLineCount = options.logVisibleLineCount;
  const logsRefreshIntervalMs = options.logsRefreshIntervalMs ?? 250;
  let shouldQuit = false;
  let pulseItem: { type: "service"; index: number } | { type: "command"; index: number } | undefined;
  let pulseTimer: ReturnType<typeof setTimeout> | undefined;
  let mode = "dashboard" as ViewMode;
  let helpReturnMode: HelpReturnMode = "dashboard";
  let commandReturnMode: CommandReturnMode = "dashboard";
  let commandHelpContext: HelpContext = "dashboard";
  let commandInput = "";
  let commandError: string | undefined;
  let logScrollOffset = 0;
  let followLogTail = true;
  let pendingKeyRead: Promise<Awaited<ReturnType<KeyInput["readKey"]>>> | undefined;
  let lastDashboardContents: string | undefined;

  renderDashboardFrame();

  while (!shouldQuit) {
    const currentMode: ViewMode = mode;
    const event =
      currentMode === "logs" || shouldRefreshDashboardPreview()
        ? await readKeyOrRefresh(logsRefreshIntervalMs)
        : await readKeyOrAbort();

    if (event.type === "abort") {
      return { type: "exit" };
    }

    if (event.type === "key" && isCtrlC(event.keypress)) {
      return { type: "exit" };
    }

    if (currentMode === "command") {
      if (event.type === "refresh") {
        continue;
      }

      const commandAction = handleCommandKey(event.keypress);

      switch (commandAction) {
        case "cancel":
          clearPulse();
          mode = commandReturnMode;
          renderCurrentMode();
          break;
        case "submit": {
          const result = parseCommand(commandInput);

          if (result.type === "quit") {
            shouldQuit = true;
          } else if (result.type === "help") {
            helpReturnMode = commandHelpContext;
            mode = "help";
            renderHelpFrame(commandHelpContext);
          } else {
            commandError = result.message;
            renderCommandFrame();
          }
          break;
        }
        case "edit":
          renderCommandFrame();
          break;
        case "none":
          break;
      }

      continue;
    }

    if (currentMode === "help") {
      if (event.type === "refresh") {
        continue;
      }

      const action = mapHelpKey(event.keypress);

      switch (action) {
        case "back":
          clearPulse();
          mode = helpReturnMode;
          renderCurrentMode();
          break;
        case "openCommand":
          openCommandMode("help", helpReturnMode);
          break;
        case "quit":
          shouldQuit = true;
          break;
        case "none":
          break;
      }

      continue;
    }

    if (currentMode === "logs") {
      if (event.type === "refresh") {
        const logs = options.controller.getSelectedServiceLogs();

        logScrollOffset = followLogTail
          ? maxScrollOffset(logs.length, getLogVisibleLineCount())
          : clampScrollOffset(logScrollOffset, logs.length, getLogVisibleLineCount());
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
            getLogVisibleLineCount(),
          );
          followLogTail = logScrollOffset === maxScrollOffset(logs.length, getLogVisibleLineCount());
          renderLogsFrame();
          break;
        case "scrollUp":
          logScrollOffset = clampScrollOffset(
            logScrollOffset - 1,
            logs.length,
            getLogVisibleLineCount(),
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
          logScrollOffset = maxScrollOffset(logs.length, getLogVisibleLineCount());
          followLogTail = true;
          renderLogsFrame();
          break;
        case "openHelp":
          helpReturnMode = "logs";
          mode = "help";
          renderHelpFrame("logs");
          break;
        case "openCommand":
          openCommandMode("logs", "logs");
          break;
        case "back":
          clearPulse();
          mode = "dashboard";
          renderDashboardFrame();
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
      case "stop":
        clearDashboardMessage();
        clearPulse();
        await options.controller.stopSelectedService();
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
      case "openCommand":
        clearDashboardMessage();
        clearPulse();
        openCommandMode("dashboard", "dashboard");
        break;
      case "quit":
        clearPulse();
        shouldQuit = true;
        break;
      case "none":
        break;
    }
  }

  return { type: "back" };

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

  function renderHelpFrame(context: HelpContext): void {
    lastDashboardContents = undefined;
    renderFrame(screen, renderHelp(context));
  }

  function renderCommandFrame(): void {
    lastDashboardContents = undefined;
    renderFrame(screen, renderCommand({ input: commandInput, error: commandError }));
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

    if (mode === "command") {
      renderCommandFrame();
      return;
    }

    renderDashboardFrame();
  }

  function renderDashboardFrame(renderOptions: { skipUnchanged?: boolean } = {}): void {
    const contents = render(options.controller.getState(), {
      quitLabel: options.dashboardQuitLabel,
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
    return mode === "dashboard" && process.stdout.columns !== undefined && process.stdout.columns >= 100;
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
    }, 60);
  }

  function openCommandMode(
    returnMode: CommandReturnMode,
    helpContext: HelpContext,
  ): void {
    commandReturnMode = returnMode;
    commandHelpContext = helpContext;
    commandInput = "";
    commandError = undefined;
    mode = "command";
    renderCommandFrame();
  }

  function handleCommandKey(
    keypress: Awaited<ReturnType<KeyInput["readKey"]>>,
  ): "submit" | "cancel" | "edit" | "none" {
    if (keypress.name === "escape") {
      return "cancel";
    }

    if (keypress.name === "return" || keypress.sequence === "\r") {
      return "submit";
    }

    if (keypress.name === "backspace") {
      commandInput = commandInput.slice(0, -1);
      commandError = undefined;

      return "edit";
    }

    if (keypress.sequence !== undefined && isPrintableCommandCharacter(keypress.sequence)) {
      commandInput += keypress.sequence;
      commandError = undefined;

      return "edit";
    }

    return "none";
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

function isPrintableCommandCharacter(sequence: string): boolean {
  return sequence.length === 1 && sequence >= " " && sequence !== "\x7f";
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
