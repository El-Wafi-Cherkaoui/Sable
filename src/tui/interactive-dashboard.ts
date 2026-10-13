import { isResize, mapDashboardKey, mapHelpKey, mapMoveKey } from "../input/keymap.js";
import type { KeyInput } from "../input/terminal-key-input.js";
import type { ManagedProcessState, ServiceLogEntry } from "../process/process-manager.js";
import { getSelectedCommand, getSelectedItem, getSelectedService, runtimeServices, type RuntimeWorkspaceState } from "../runtime/runtime-state.js";
import type { SettingsControl } from "../settings/settings-control.js";
import type { SoundControl } from "../sound/sound-control.js";
import { runSettingsDialog } from "./settings-dialog.js";
import { renderHelpView, type HelpContext } from "./help-view.js";
import { createDashboardEventReader } from "./dashboard-events.js";
import { createLogsSession } from "./logs-session.js";
import { renderLogsView } from "./logs-view.js";
import { missingSecretsOf } from "../config/workspace-items.js";
import { explainFailure, explainMissingSecrets } from "../runtime/failure-hint.js";
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
  // Starts every service in dependency order without waiting for it to finish.
  startAll?(): "started" | "busy" | "nothing";
  isStarting?(): boolean;
};

export type InteractiveDashboardScreen = {
  clear(): void;
  // Wipes the whole terminal, used after a resize left stale text behind.
  clearAll?(): void;
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
  settings?: SettingsControl;
  runSettings?: typeof runSettingsDialog;
  dashboardQuitLabel?: string;
  initialMessage?: string;
  logVisibleLineCount?: number;
  logsRefreshIntervalMs?: number;
  logsRevealIntervalMs?: number;
  onAddService?: () => Promise<DashboardCallbackResult>;
  onEditService?: () => Promise<DashboardCallbackResult>;
  onDeleteService?: (context: { background?: string }) => Promise<DashboardCallbackResult>;
  onManageSavedLogs?: (context: { background?: string }) => Promise<DashboardCallbackResult>;
  // Called before an item that needs secret variables is started and some have no value. "ready" means they
  // are set now and it can start; "cancelled" leaves it stopped, with a message.
  onMissingSecrets?: (context: { itemId: string; background?: string }) => Promise<{ type: "ready" } | { type: "cancelled"; message: string } | { type: "exit" }>;
  onMoveServiceUp?: () => Promise<DashboardCallbackResult>;
  onMoveServiceDown?: () => Promise<DashboardCallbackResult>;
};

export type InteractiveDashboardResult = { type: "back" } | { type: "exit" };

type ViewMode = "dashboard" | "logs" | "help" | "move";
type HelpReturnMode = "dashboard" | "logs";

export async function runInteractiveDashboard(
  options: RunInteractiveDashboardOptions,
): Promise<InteractiveDashboardResult> {
  const screen = options.screen ?? terminalScreen;
  const color = shouldUseColor();
  let dashboardMessage: string | undefined = options.initialMessage;
  const render = options.render ?? renderStaticDashboard;
  const renderLogs = options.renderLogs ?? renderLogsView;
  const renderHelp = options.renderHelp ?? renderHelpView;
  const logsSession = createLogsSession({
    getLogs: () => options.controller.getSelectedServiceLogs(),
    visibleLineCount: options.logVisibleLineCount,
  });
  const events = createDashboardEventReader(options.keyInput, options.abortSignal);
  const logsRefreshIntervalMs = options.logsRefreshIntervalMs ?? 250;
  const logsRevealIntervalMs = options.logsRevealIntervalMs ?? 55;
  let shouldQuit = false;
  let pulseItem: number | undefined;
  let pulseTimer: ReturnType<typeof setTimeout> | undefined;
  const startingGraceTicks = 3;
  let refreshGraceTicks = 0;
  let mode = "dashboard" as ViewMode;
  let helpReturnMode: HelpReturnMode = "dashboard";
  // Net number of positions the service moved in move mode, so Esc can undo it.
  let moveOffset = 0;
  let lastDashboardContents: string | undefined;
  // The last dashboard or logs frame, shown dimmed behind the help popup.
  let lastScreenContents: string | undefined;

  renderDashboardFrame();

  try {
    while (!shouldQuit) {
    const currentMode: ViewMode = mode;
    const refreshIntervalMs = currentMode === "logs" && logsSession.isRevealActive()
      ? logsRevealIntervalMs
      : logsRefreshIntervalMs;
    const event =
      currentMode === "logs" || shouldRefreshDashboardPreview()
        ? await events.readKeyOrRefresh(refreshIntervalMs)
        : await events.readKeyOrAbort();

    if (event.type === "abort") {
      return { type: "exit" };
    }

    if (event.type === "key" && isCtrlC(event.keypress)) {
      return { type: "exit" };
    }

    if (event.type === "key" && isResize(event.keypress)) {
      if (currentMode === "logs") {
        logsSession.resize();
      }

      screen.clearAll?.();
      lastDashboardContents = undefined;
      renderCurrentMode();
      continue;
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
        logsSession.refresh();
        renderLogsFrame();
        continue;
      }

      switch (logsSession.handleKey(event.keypress)) {
        case "render":
          renderLogsFrame();
          break;
        case "openHelp":
          helpReturnMode = "logs";
          mode = "help";
          renderHelpFrame("logs");
          break;
        case "back":
          clearPulse();
          options.sound?.play("back");
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
        options.sound?.play("move");
        pulseItem = options.controller.getState().selectedItemIndex;
        schedulePulseClear();
        renderDashboardFrame();
        break;
      case "selectPrevious":
        clearDashboardMessage();
        clearPulse();
        options.controller.selectPreviousService();
        options.sound?.play("move");
        pulseItem = options.controller.getState().selectedItemIndex;
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
          const secrets = await ensureSecrets();

          if (secrets === "exit") {
            return { type: "exit" };
          }

          if (secrets === "cancelled") {
            renderDashboardFrame();
            break;
          }

          options.sound?.play("started");
          await options.controller.startSelectedService();
        }
        pulseItem = options.controller.getState().selectedItemIndex;
        schedulePulseClear();
        renderDashboardFrame();
        break;
      case "restart": {
        clearDashboardMessage();
        clearPulse();
        if (isSelectedItemRunning(options.controller.getState())) {
          showBusyMessage("Restarting");
        }

        const secretsForRestart = await ensureSecrets();

        if (secretsForRestart === "exit") {
          return { type: "exit" };
        }

        if (secretsForRestart === "cancelled") {
          renderDashboardFrame();
          break;
        }

        options.sound?.play("started");
        await options.controller.restartSelectedService();
        clearDashboardMessage();
        pulseItem = options.controller.getState().selectedItemIndex;
        schedulePulseClear();
        renderDashboardFrame();
        break;
      }
      case "startAll": {
        clearPulse();

        const outcome = options.controller.startAll?.() ?? "nothing";

        if (outcome === "started") {
          options.sound?.play("started");
        }

        dashboardMessage = outcome === "started"
          ? "Starting all services..."
          : outcome === "busy"
            ? "Already starting."
            : "No services to start.";
        refreshGraceTicks = startingGraceTicks;
        renderDashboardFrame();
        break;
      }
      case "savedLogs": {
        clearPulse();

        if (options.onManageSavedLogs === undefined) {
          dashboardMessage = "Saved logs are not available here.";
        } else {
          const result = await options.onManageSavedLogs({ background: lastScreenContents });

          if (result.type === "exit") {
            return { type: "exit" };
          }

          dashboardMessage = result.message;
        }

        renderDashboardFrame();
        break;
      }
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
      case "openLogs":
        options.sound?.play("open");
        clearDashboardMessage();
        clearPulse();
        mode = "logs";
        logsSession.open();
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
        if (options.settings === undefined) {
          break;
        }

        clearDashboardMessage();
        clearPulse();

        const outcome = await (options.runSettings ?? runSettingsDialog)({
          settings: options.settings,
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
        } else if (getSelectedService(state) !== undefined && runtimeServices(state).length > 1) {
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
    lastDashboardContents = undefined;
    const state = options.controller.getState();
    const view = logsSession.viewProps();

    lastScreenContents = renderLogs({
      ...view,
      state,
      hint: explainMissingSecrets(getSelectedItem(state)) ?? explainFailure(getSelectedItem(state), view.logs),
      color,
    });
    renderFrame(screen, lastScreenContents);
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
    const state = options.controller.getState();
    const selectedServiceLogs = options.controller.getSelectedServiceLogs();
    const contents = render(state, {
      quitLabel: options.dashboardQuitLabel,
      moving: mode === "move",
      settingsAvailable: options.settings !== undefined,
      savedLogsAvailable: options.onManageSavedLogs !== undefined && options.settings?.persistLogs.isEnabled() === true,
      statusMessage: dashboardMessage,
      pulseItemIndex: pulseItem,
      selectedServiceLogs,
      failureHint: explainMissingSecrets(getSelectedItem(state)) ?? explainFailure(getSelectedItem(state), selectedServiceLogs),
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
    if (mode !== "dashboard" && mode !== "move") {
      return false;
    }

    // While items are starting in order, keep redrawing so "waiting" turns into "running" on its own;
    // a couple of extra redraws after the last start catch the final change.
    if (options.controller.isStarting?.() === true) {
      refreshGraceTicks = startingGraceTicks;

      return true;
    }

    if (refreshGraceTicks > 0) {
      refreshGraceTicks -= 1;

      return true;
    }

    return process.stdout.columns !== undefined && process.stdout.columns >= 100;
  }

  // Before starting the selected item: if it needs secret variables that have no value, ask for them first.
  async function ensureSecrets(): Promise<"ready" | "cancelled" | "exit"> {
    const selected = getSelectedItem(options.controller.getState());

    if (selected === undefined || missingSecretsOf(selected.item).length === 0) {
      return "ready";
    }

    if (options.onMissingSecrets === undefined) {
      dashboardMessage = `"${selected.item.name}" needs ${missingSecretsOf(selected.item).join(", ")}.`;

      return "cancelled";
    }

    const outcome = await options.onMissingSecrets({ itemId: selected.item.id, background: lastScreenContents });

    if (outcome.type === "cancelled") {
      dashboardMessage = outcome.message;
    }

    return outcome.type;
  }

  // Stopping can take a few seconds while the loop waits, so say what is happening first.
  function showBusyMessage(verb: string): void {
    const name = getSelectedItem(options.controller.getState())?.item.name ?? "item";

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
      const serviceName = getSelectedService(options.controller.getState())?.item.name;

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

    const indexBefore = options.controller.getState().selectedItemIndex;
    const result = await callback();

    if (result.type === "exit") {
      return "exit";
    }

    const indexAfter = options.controller.getState().selectedItemIndex;

    if (indexBefore === undefined || indexAfter === undefined || indexBefore === indexAfter) {
      return "unchanged";
    }

    moveOffset += indexAfter - indexBefore;
    return "moved";
  }
}

function isCtrlC(keypress: Awaited<ReturnType<KeyInput["readKey"]>>): boolean {
  return keypress.ctrl === true && keypress.name === "c";
}

// An item held back by the start-all plan counts as running: s cancels its start instead of starting it.
function isSelectedItemRunning(state: RuntimeWorkspaceState): boolean {
  const selected = getSelectedItem(state);

  return selected?.process.status === "running" || selected?.queue?.status === "waiting";
}

function renderFrame(screen: InteractiveDashboardScreen, contents: string): void {
  screen.clear();
  screen.write(`${contents}\n`);
}

const terminalScreen: InteractiveDashboardScreen = {
  clear() {
    process.stdout.write("\x1b[H");
  },
  clearAll() {
    process.stdout.write("\x1b[2J\x1b[H");
  },
  write(contents) {
    process.stdout.write(`${clearLineEnds(contents)}\x1b[J`);
  },
};

function clearLineEnds(contents: string): string {
  return contents.replace(/\n/g, "\x1b[K\n");
}
