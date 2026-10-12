import type { WorkspaceConfig } from "../config/config-types.js";
import { sableLogoAnsi, sableLogoAnsiWidth } from "../generated/sable-logo-ansi.js";
import { mapHelpKey, mapMoveKey, mapWorkspacePickerKey } from "../input/keymap.js";
import type { KeyInput } from "../input/terminal-key-input.js";
import { product } from "../shared/product.js";
import { displayPath } from "./format.js";
import { renderHelpBox, type HelpViewOptions } from "./help-view.js";
import { formatKeyHints, type KeyHint } from "./key-hints.js";
import { appendAnchoredFooter, clipLines } from "./layout.js";
import { createTuiStyle, shouldUseColor, type TuiStyle } from "./style.js";
import { padVisibleEnd, truncateVisible, visibleLength } from "./width.js";

export type WorkspacePickerState = {
  workspaces: WorkspaceConfig[];
  selectedWorkspaceIndex: number | undefined;
  activeWorkspaceId?: string;
  statusMessage?: string;
  moving?: boolean;
  activeRunningServiceCount?: number;
};

export type WorkspacePickerResult =
  | { type: "run"; workspace: WorkspaceConfig }
  | { type: "createWorkspace" }
  | { type: "deleteWorkspace"; workspace: WorkspaceConfig; background?: string }
  | { type: "renameWorkspace"; workspace: WorkspaceConfig }
  | { type: "stopActiveWorkspace"; workspace: WorkspaceConfig }
  | { type: "restartActiveWorkspace"; workspace: WorkspaceConfig }
  | { type: "reorderWorkspace"; workspace: WorkspaceConfig; index: number }
  | { type: "update" }
  | { type: "exit" };

export type WorkspacePickerScreen = {
  clear(): void;
  write(contents: string): void;
};

export type RenderWorkspacePickerOptions = {
  color?: boolean;
  style?: TuiStyle;
  columns?: number;
  rows?: number;
};

export type RunWorkspacePickerOptions = {
  workspaces: WorkspaceConfig[];
  keyInput: KeyInput;
  abortSignal?: AbortSignal;
  screen?: WorkspacePickerScreen;
  render?: typeof renderWorkspacePicker;
  renderStartupMoment?: typeof renderWorkspaceStartupMoment;
  renderHelp?: typeof renderWorkspacePickerHelp;
  renderDetails?: typeof renderWorkspaceDetails;
  statusMessage?: string;
  selectedWorkspaceId?: string;
  activeWorkspaceId?: string;
  activeRunningServiceCount?: number;
  startupMomentMs?: number;
  // Runs once after the startup logo, before the list appears (e.g. the update popup).
  afterStartup?: () => Promise<"continue" | "update" | "exit">;
};

type PickerMode = "picker" | "help" | "details" | "move";
type PickerEvent =
  | { type: "key"; keypress: Awaited<ReturnType<KeyInput["readKey"]>> }
  | { type: "abort" };

export async function runWorkspacePicker(
  options: RunWorkspacePickerOptions,
): Promise<WorkspacePickerResult> {
  const screen = options.screen ?? terminalScreen;
  const color = shouldUseColor();
  const render = options.render ?? ((state: WorkspacePickerState) => renderWorkspacePicker(state, {
    color,
    columns: process.stdout.columns,
    rows: process.stdout.rows,
  }));
  const renderStartupMoment = options.renderStartupMoment ?? (() => renderWorkspaceStartupMoment({
    color,
    columns: process.stdout.columns,
    rows: process.stdout.rows,
  }));
  const renderHelp = options.renderHelp ?? renderWorkspacePickerHelp;
  const renderDetails = options.renderDetails ?? ((workspace: WorkspaceConfig) => renderWorkspaceDetails(workspace, { color }));
  let state: WorkspacePickerState = {
    ...createWorkspacePickerState(
      options.workspaces,
      options.statusMessage,
      options.selectedWorkspaceId,
      options.activeWorkspaceId,
    ),
    activeRunningServiceCount: options.activeRunningServiceCount,
  };
  let mode: PickerMode = "picker";
  let stateBeforeMove: WorkspacePickerState | undefined;
  let pendingKeyRead: Promise<Awaited<ReturnType<KeyInput["readKey"]>>> | undefined;
  let queuedEvent = await runStartupMoment();

  if (options.afterStartup !== undefined && (options.startupMomentMs ?? 0) > 0) {
    const outcome = await options.afterStartup();

    if (outcome === "update") {
      return { type: "update" };
    }

    if (outcome === "exit") {
      return { type: "exit" };
    }

    // Keys pressed while the popup was open belonged to it, not the list: drop
    // the read started during the logo so it can't replay them here.
    queuedEvent = undefined;
    pendingKeyRead = undefined;
  }

  renderFrame(screen, render(state));

  while (true) {
    const event = queuedEvent ?? await readKeyOrAbort();

    queuedEvent = undefined;

    if (event.type === "abort" || isCtrlC(event.keypress)) {
      return { type: "exit" };
    }

    if (mode === "help" || mode === "details") {
      if (mapHelpKey(event.keypress) === "back") {
        mode = "picker";
        renderFrame(screen, render(state));
      }

      continue;
    }

    if (mode === "move") {
      const moveAction = mapMoveKey(event.keypress);

      if (moveAction === "moveUp" || moveAction === "moveDown") {
        state = moveSelectedWorkspace(state, moveAction === "moveUp" ? "up" : "down");
        renderFrame(screen, render(state));
        continue;
      }

      if (moveAction === "done" || moveAction === "cancel") {
        const originalIndex = stateBeforeMove?.selectedWorkspaceIndex;
        const workspace = getSelectedWorkspace(state);

        if (
          moveAction === "done"
          && workspace !== undefined
          && state.selectedWorkspaceIndex !== undefined
          && state.selectedWorkspaceIndex !== originalIndex
        ) {
          return { type: "reorderWorkspace", workspace, index: state.selectedWorkspaceIndex };
        }

        state = { ...(stateBeforeMove ?? state), moving: false };
        stateBeforeMove = undefined;
        mode = "picker";
        renderFrame(screen, render(state));
      }

      continue;
    }

    const action = mapWorkspacePickerKey(event.keypress);

    switch (action) {
      case "selectNext":
        state = selectNextWorkspace(state);
        renderFrame(screen, render(state));
        break;
      case "selectPrevious":
        state = selectPreviousWorkspace(state);
        renderFrame(screen, render(state));
        break;
      case "run": {
        const workspace = getSelectedWorkspace(state);

        if (workspace !== undefined) {
          return { type: "run", workspace };
        }

        break;
      }
      case "view": {
        const workspace = getSelectedWorkspace(state);

        if (workspace !== undefined) {
          mode = "details";
          renderFrame(screen, renderDetails(workspace));
        }

        break;
      }
      case "createWorkspace":
        return { type: "createWorkspace" };
      case "deleteWorkspace": {
        const workspace = getSelectedWorkspace(state);

        if (workspace !== undefined) {
          return { type: "deleteWorkspace", workspace, background: render(state) };
        }

        break;
      }
      case "renameWorkspace": {
        const workspace = getSelectedWorkspace(state);

        if (workspace !== undefined) {
          return { type: "renameWorkspace", workspace };
        }

        break;
      }
      case "stopActiveWorkspace": {
        const workspace = getSelectedWorkspace(state);

        if (workspace !== undefined) {
          return { type: "stopActiveWorkspace", workspace };
        }

        break;
      }
      case "restartActiveWorkspace": {
        const workspace = getSelectedWorkspace(state);

        if (workspace !== undefined) {
          return { type: "restartActiveWorkspace", workspace };
        }

        break;
      }
      case "startMove":
        if (getSelectedWorkspace(state) !== undefined && state.workspaces.length > 1) {
          stateBeforeMove = state;
          state = { ...state, statusMessage: undefined, moving: true };
          mode = "move";
          renderFrame(screen, render(state));
        }

        break;
      case "moveWorkspaceUp":
      case "moveWorkspaceDown": {
        const workspace = getSelectedWorkspace(state);
        const index = (state.selectedWorkspaceIndex ?? 0) + (action === "moveWorkspaceUp" ? -1 : 1);

        if (workspace !== undefined && index >= 0 && index < state.workspaces.length) {
          return { type: "reorderWorkspace", workspace, index };
        }

        break;
      }
      case "openHelp":
        mode = "help";
        renderFrame(screen, renderHelp({ background: render(state), columns: process.stdout.columns, rows: process.stdout.rows, color }));
        break;
      case "quit":
        return { type: "exit" };
      case "none":
        break;
    }
  }

  async function runStartupMoment(): Promise<PickerEvent | undefined> {
    const durationMs = options.startupMomentMs ?? 0;

    if (durationMs <= 0) {
      return undefined;
    }

    renderFrame(screen, renderStartupMoment());

    const event = await readKeyAbortOrTimeout(durationMs);

    return event.type === "timeout" ? undefined : event;
  }

  async function readKeyEvent(): Promise<Awaited<ReturnType<KeyInput["readKey"]>>> {
    pendingKeyRead ??= options.keyInput.readKey();
    const keypress = await pendingKeyRead;

    pendingKeyRead = undefined;

    return keypress;
  }

  async function readKeyOrAbort(): Promise<PickerEvent> {
    return Promise.race([
      readKeyEvent().then((keypress) => ({ type: "key" as const, keypress })),
      waitForAbort(options.abortSignal).then(() => ({ type: "abort" as const })),
    ]);
  }

  async function readKeyAbortOrTimeout(
    timeoutMs: number,
  ): Promise<PickerEvent | { type: "timeout" }> {
    pendingKeyRead ??= options.keyInput.readKey();

    const event = await Promise.race([
      pendingKeyRead.then((keypress) => ({ type: "key" as const, keypress })),
      waitForAbort(options.abortSignal).then(() => ({ type: "abort" as const })),
      wait(timeoutMs).then(() => ({ type: "timeout" as const })),
    ]);

    if (event.type === "key") {
      pendingKeyRead = undefined;
    }

    return event;
  }
}

export function createWorkspacePickerState(
  workspaces: WorkspaceConfig[],
  statusMessage?: string,
  selectedWorkspaceId?: string,
  activeWorkspaceId?: string,
): WorkspacePickerState {
  const selectedWorkspaceIndex = selectedWorkspaceId === undefined
    ? undefined
    : workspaces.findIndex((workspace) => workspace.id === selectedWorkspaceId);

  return {
    workspaces,
    selectedWorkspaceIndex: selectedWorkspaceIndex !== undefined && selectedWorkspaceIndex >= 0
      ? selectedWorkspaceIndex
      : workspaces.length > 0 ? 0 : undefined,
    activeWorkspaceId,
    statusMessage,
  };
}

export function selectNextWorkspace(state: WorkspacePickerState): WorkspacePickerState {
  if (state.workspaces.length === 0) {
    return state;
  }

  return {
    ...state,
    statusMessage: undefined,
    selectedWorkspaceIndex:
      ((state.selectedWorkspaceIndex ?? 0) + 1) % state.workspaces.length,
  };
}

export function selectPreviousWorkspace(
  state: WorkspacePickerState,
): WorkspacePickerState {
  if (state.workspaces.length === 0) {
    return state;
  }

  const selectedWorkspaceIndex = state.selectedWorkspaceIndex ?? 0;

  return {
    ...state,
    statusMessage: undefined,
    selectedWorkspaceIndex:
      (selectedWorkspaceIndex - 1 + state.workspaces.length) % state.workspaces.length,
  };
}

export function moveSelectedWorkspace(
  state: WorkspacePickerState,
  direction: "up" | "down",
): WorkspacePickerState {
  const fromIndex = state.selectedWorkspaceIndex;

  if (fromIndex === undefined) {
    return state;
  }

  const toIndex = direction === "up" ? fromIndex - 1 : fromIndex + 1;

  if (toIndex < 0 || toIndex >= state.workspaces.length) {
    return state;
  }

  const workspaces = [...state.workspaces];
  const [workspace] = workspaces.splice(fromIndex, 1);

  workspaces.splice(toIndex, 0, workspace!);

  return { ...state, workspaces, selectedWorkspaceIndex: toIndex };
}

export function getSelectedWorkspace(
  state: WorkspacePickerState,
): WorkspaceConfig | undefined {
  if (state.selectedWorkspaceIndex === undefined) {
    return undefined;
  }

  return state.workspaces[state.selectedWorkspaceIndex];
}

export function renderWorkspacePicker(
  state: WorkspacePickerState,
  options: RenderWorkspacePickerOptions = {},
): string {
  return clipLines(renderPickerLines(state, options), options.columns);
}

function renderPickerLines(
  state: WorkspacePickerState,
  options: RenderWorkspacePickerOptions,
): string {
  const style = options.style ?? createTuiStyle(options.color ?? false);
  const color = options.color === true;
  const statusLine = formatPickerStatusLine(state.statusMessage, style);
  const footer = formatKeyHints(getPickerKeyHints(state), style, options.columns === undefined ? undefined : options.columns - 1);
  const count = state.workspaces.length;
  const lines = [`${style.title(product.displayName)}${style.muted(` · ${count} ${count === 1 ? "workspace" : "workspaces"}`)}`, ""];

  if (count === 0) {
    const welcome = [
      style.title(`Welcome to ${product.displayName}`),
      "",
      "A workspace is a project folder plus the services you run in it,",
      "like a dev server, a worker, or a database.",
      "",
      "Start them together, see their logs in one place, and switch",
      "between projects with one key.",
      "",
      style.muted("Press a to create your first workspace."),
    ];

    appendAnchoredFooter(welcome, ["", statusLine, footer], options.rows);
    return welcome.join("\n");
  }

  const maxWidth = Math.max(20, (options.columns ?? 80) - 1);
  const nameWidth = Math.max(...state.workspaces.map((workspace) => visibleLength(workspace.name)));
  const statusWidth = "● running".length;
  const servicesText = (workspace: WorkspaceConfig) => {
    const total = workspace.services.length;

    return workspace.id === state.activeWorkspaceId && state.activeRunningServiceCount !== undefined
      ? `${state.activeRunningServiceCount}/${total} services`
      : `${total} ${total === 1 ? "service" : "services"}`;
  };
  const servicesWidth = Math.max(...state.workspaces.map((workspace) => servicesText(workspace).length));
  // Name, status, and service count are aligned columns; the folder fills what is left.
  const pathStart = 2 + nameWidth + 2 + statusWidth + 2 + servicesWidth + 2;
  const rows = state.workspaces.map((workspace, index) => {
    const selected = index === state.selectedWorkspaceIndex;
    const isRunning = workspace.id === state.activeWorkspaceId && state.activeRunningServiceCount !== 0;
    const status = isRunning ? style.running("● running") : style.muted("○ stopped");
    const moving = state.moving === true && selected ? `  ${style.muted("↕ moving")}` : "";
    const folder = truncateVisible(displayPath(workspace.projectDirectory), Math.max(8, maxWidth - pathStart - visibleLength(moving)));

    return `${selected ? "> " : "  "}${padVisibleEnd(workspace.name, nameWidth)}  ${padVisibleEnd(status, statusWidth)}  ${style.muted(padVisibleEnd(servicesText(workspace), servicesWidth))}  ${style.muted(folder)}${moving}`;
  });
  const rowWidth = Math.min(maxWidth, Math.max(...rows.map((row) => visibleLength(row))));

  for (const [index, row] of rows.entries()) {
    lines.push(index === state.selectedWorkspaceIndex ? style.selected(color ? padVisibleEnd(row, rowWidth) : row) : row);
  }

  appendAnchoredFooter(lines, ["", statusLine, footer], options.rows);

  return lines.join("\n");
}

export function renderWorkspaceStartupMoment(
  options: RenderWorkspacePickerOptions = {},
): string {
  const style = options.style ?? createTuiStyle(options.color ?? false);
  const body = shouldRenderAnsiStartupLogo(options)
    ? renderAnsiStartupBanner(style, options.columns)
    : shouldRenderTextStartupBanner(options.columns)
    ? renderTextStartupBanner(style, options.columns)
    : renderCompactStartupMoment(style, options.columns);
  const leadingBlankLines = options.rows === undefined || options.rows <= body.length
    ? 1
    : Math.max(1, Math.floor((options.rows - body.length) / 2));

  return [
    ...Array.from({ length: leadingBlankLines }, () => ""),
    ...body,
  ].join("\n");
}

function shouldRenderTextStartupBanner(columns: number | undefined): boolean {
  return columns === undefined || columns >= startupBannerWidth;
}

function shouldRenderAnsiStartupLogo(options: RenderWorkspacePickerOptions): boolean {
  return options.color === true
    && process.env.NO_COLOR === undefined
    && process.env.TERM !== "dumb"
    && (options.columns === undefined || options.columns >= sableLogoAnsiWidth);
}

function renderAnsiStartupBanner(style: TuiStyle, columns: number | undefined): string[] {
  return [
    ...sableLogoAnsi.map((line) => centerVisible(line, columns)),
    "",
    centerVisible(style.title(product.displayName), columns),
    centerVisible(style.muted("Keyboard-first Workspace Manager"), columns),
    centerVisible(style.muted("─".repeat(sableLogoAnsiWidth)), columns),
  ];
}

function renderTextStartupBanner(style: TuiStyle, columns: number | undefined): string[] {
  return [
    ...startupBannerLines.map((line) => centerVisible(style.title(padVisibleEnd(line, startupBannerWidth)), columns)),
    "",
    centerVisible(style.title(product.displayName), columns),
    centerVisible(style.muted("Keyboard-first Workspace Manager"), columns),
    centerVisible(style.muted("─".repeat(startupBannerWidth)), columns),
  ];
}

function renderCompactStartupMoment(style: TuiStyle, columns: number | undefined): string[] {
  return [
    centerVisible(style.title(`· ${product.binaryName} ·`), columns),
    "",
    centerVisible(style.muted("workspace ready"), columns),
  ];
}

const startupBannerLines = [
  "███████╗ █████╗ ██████╗ ██╗     ███████╗",
  "██╔════╝██╔══██╗██╔══██╗██║     ██╔════╝",
  "███████╗███████║██████╔╝██║     █████╗",
  "╚════██║██╔══██║██╔══██╗██║     ██╔══╝",
  "███████║██║  ██║██████╔╝███████╗███████╗",
  "╚══════╝╚═╝  ╚═╝╚═════╝ ╚══════╝╚══════╝",
];
const startupBannerWidth = Math.max(...startupBannerLines.map((line) => visibleLength(line)));


function centerVisible(value: string, columns: number | undefined): string {
  if (columns === undefined || columns <= visibleLength(value)) {
    return value;
  }

  return `${" ".repeat(Math.floor((columns - visibleLength(value)) / 2))}${value}`;
}

function getPickerKeyHints(state: WorkspacePickerState): KeyHint[] {
  if (state.moving === true) {
    return [["↑↓", "move"], ["Enter", "done"], ["Esc", "cancel"]];
  }

  if (state.workspaces.length === 0) {
    return [["a", "create your first workspace"], ["?", "help"], ["q", "quit"]];
  }

  if (getSelectedWorkspace(state)?.id === state.activeWorkspaceId) {
    return [["↑↓", "select"], ["Enter", "open"], ["s", "stop"], ["r", "restart"], ["?", "help"], ["q", "quit"]];
  }

  return [["↑↓", "select"], ["Enter", "open"], ["a", "add"], ["e", "rename"], ["?", "help"], ["q", "quit"]];
}

function formatPickerStatusLine(
  statusMessage: string | undefined,
  style: TuiStyle,
): string {
  if (statusMessage === undefined) {
    return "";
  }

  return `${style.statusLabel("›")} ${statusMessage}`;
}

export function renderWorkspacePickerHelp(options: HelpViewOptions = {}): string {
  return renderHelpBox("Help · workspaces", [
    {
      heading: "Moving around",
      rows: ["↑ / ↓       select workspace", "Enter       open selected workspace"],
    },
    {
      heading: "Workspaces",
      rows: [
        "a           add a workspace",
        "e           rename selected workspace",
        "d           delete selected workspace",
        "m           move selected workspace (↑ ↓, then Enter)",
        "v           view services in selected workspace",
      ],
    },
    {
      heading: "Running workspace",
      rows: ["s           stop it", "r           restart its services"],
    },
    {
      rows: ["q           quit Sable (from this screen)", "Ctrl+C      quit Sable from anywhere"],
    },
  ], options);
}

export function renderWorkspaceDetails(
  workspace: WorkspaceConfig,
  options: RenderWorkspacePickerOptions = {},
): string {
  const style = options.style ?? createTuiStyle(options.color ?? false);
  const lines = [`${style.title(workspace.name)}${style.muted(` · ${displayPath(workspace.projectDirectory)}`)}`, ""];
  const items = [
    ...workspace.services.map((service) => ({ kind: "service" as const, item: service })),
    ...workspace.commands.map((command) => ({ kind: "command" as const, item: command })),
  ];
  const nameWidth = Math.max(8, ...items.map(({ item }) => visibleLength(item.name)));

  if (items.length === 0) {
    lines.push("No services or commands yet.");
  }

  for (const kind of ["service", "command"] as const) {
    const ofKind = items.filter((entry) => entry.kind === kind);

    if (ofKind.length === 0) {
      continue;
    }

    if (lines.length > 2) {
      lines.push("");
    }

    lines.push(style.muted(kind === "service" ? "SERVICES" : "COMMANDS"));

    for (const { item } of ofKind) {
      const envCount = Object.keys(item.env).length;
      const notes = [
        `in ${item.cwd}`,
        ...("autoStart" in item && item.autoStart ? ["auto-start"] : []),
        ...(envCount > 0 ? [`${envCount} env ${envCount === 1 ? "variable" : "variables"}`] : []),
      ];

      lines.push(`  ${padVisibleEnd(item.name, nameWidth)}  ${item.command}`);
      lines.push(`  ${" ".repeat(nameWidth)}  ${style.muted(notes.join(" · "))}`);
    }
  }

  lines.push("", formatKeyHints([["Esc", "back"]], style));

  return lines.join("\n");
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

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function renderFrame(screen: WorkspacePickerScreen, contents: string): void {
  screen.clear();
  screen.write(`${contents}\n`);
}

const terminalScreen: WorkspacePickerScreen = {
  clear() {
    process.stdout.write("\x1b[2J\x1b[H");
  },
  write(contents) {
    process.stdout.write(contents);
  },
};
