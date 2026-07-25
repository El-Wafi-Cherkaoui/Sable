import { mapDashboardKey, mapHelpKey, mapLogsKey } from "../input/keymap.js";
import type { KeyInput } from "../input/terminal-key-input.js";
import type { ManagedProcessState, ServiceLogEntry } from "../process/process-manager.js";
import type { RuntimeWorkspaceState } from "../runtime/runtime-state.js";
import { parseCommand, renderCommandView } from "./command-view.js";
import { renderHelpView, type HelpContext } from "./help-view.js";
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
  abortSignal?: AbortSignal;
  screen?: InteractiveDashboardScreen;
  render?: typeof renderStaticDashboard;
  renderLogs?: typeof renderLogsView;
  renderHelp?: typeof renderHelpView;
  renderCommand?: typeof renderCommandView;
  dashboardQuitLabel?: string;
  logVisibleLineCount?: number;
  logsRefreshIntervalMs?: number;
};

export type InteractiveDashboardResult = { type: "back" } | { type: "exit" };

type ViewMode = "dashboard" | "logs" | "help" | "command";
type HelpReturnMode = "dashboard" | "logs";
type CommandReturnMode = ViewMode;
type LoopEvent =
  | { type: "key"; keypress: Awaited<ReturnType<KeyInput["readKey"]>> }
  | { type: "refresh" }
  | { type: "abort" };

export async function runInteractiveDashboard(
  options: RunInteractiveDashboardOptions,
): Promise<InteractiveDashboardResult> {
  const screen = options.screen ?? terminalScreen;
  const render =
    options.render ??
    ((state: RuntimeWorkspaceState) =>
      renderStaticDashboard(state, { quitLabel: options.dashboardQuitLabel }));
  const renderLogs = options.renderLogs ?? renderLogsView;
  const renderHelp = options.renderHelp ?? renderHelpView;
  const renderCommand = options.renderCommand ?? renderCommandView;
  const logVisibleLineCount = options.logVisibleLineCount ?? 20;
  const logsRefreshIntervalMs = options.logsRefreshIntervalMs ?? 250;
  let shouldQuit = false;
  let mode = "dashboard" as ViewMode;
  let helpReturnMode: HelpReturnMode = "dashboard";
  let commandReturnMode: CommandReturnMode = "dashboard";
  let commandHelpContext: HelpContext = "dashboard";
  let commandInput = "";
  let commandError: string | undefined;
  let logScrollOffset = 0;
  let followLogTail = true;
  let pendingKeyRead: Promise<Awaited<ReturnType<KeyInput["readKey"]>>> | undefined;

  renderFrame(screen, render(options.controller.getState()));

  while (!shouldQuit) {
    const currentMode: ViewMode = mode;
    const event =
      currentMode === "logs"
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
        case "openHelp":
          helpReturnMode = "logs";
          mode = "help";
          renderHelpFrame("logs");
          break;
        case "openCommand":
          openCommandMode("logs", "logs");
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
      case "openHelp":
        helpReturnMode = "dashboard";
        mode = "help";
        renderHelpFrame("dashboard");
        break;
      case "openCommand":
        openCommandMode("dashboard", "dashboard");
        break;
      case "quit":
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

  function renderHelpFrame(context: HelpContext): void {
    renderFrame(screen, renderHelp(context));
  }

  function renderCommandFrame(): void {
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

    renderFrame(screen, render(options.controller.getState()));
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

    const event = await Promise.race([
      pendingKeyRead.then((keypress) => ({ type: "key" as const, keypress })),
      wait(refreshIntervalMs).then(() => ({ type: "refresh" as const })),
      waitForAbort(options.abortSignal).then(() => ({ type: "abort" as const })),
    ]);

    if (event.type === "key") {
      pendingKeyRead = undefined;
    }

    return event;
  }

  async function readKeyOrAbort(): Promise<LoopEvent> {
    return Promise.race([
      readKeyEvent().then((keypress) => ({ type: "key" as const, keypress })),
      waitForAbort(options.abortSignal).then(() => ({ type: "abort" as const })),
    ]);
  }
}

function isCtrlC(keypress: Awaited<ReturnType<KeyInput["readKey"]>>): boolean {
  return keypress.ctrl === true && keypress.name === "c";
}

function waitForAbort(signal: AbortSignal | undefined): Promise<void> {
  if (signal === undefined) {
    return new Promise(() => undefined);
  }

  if (signal.aborted) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

function isPrintableCommandCharacter(sequence: string): boolean {
  return sequence.length === 1 && sequence >= " " && sequence !== "\x7f";
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
