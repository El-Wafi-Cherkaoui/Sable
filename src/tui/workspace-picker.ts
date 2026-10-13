import type { WorkspaceConfig } from "../config/config-types.js";
import { sableLogoAnsi, sableLogoAnsiWidth } from "../generated/sable-logo-ansi.js";
import { isResize, mapHelpKey, mapMoveKey, mapWorkspacePickerKey } from "../input/keymap.js";
import type { KeyInput } from "../input/terminal-key-input.js";
import { product } from "../shared/product.js";
import { displayPath } from "./format.js";
import type { SettingsControl } from "../settings/settings-control.js";
import type { SoundControl } from "../sound/sound-control.js";
import { runSettingsDialog, type SettingsDialogResult } from "./settings-dialog.js";
import { logoDotCount, renderRevealedLogo } from "./logo-reveal.js";
import { renderHelpBox, type HelpViewOptions } from "./help-view.js";
import { formatKeyHints, type KeyHint } from "./key-hints.js";
import { appendAnchoredFooter, clipLines } from "./layout.js";
import { createTuiStyle, shouldUseColor, type TuiStyle } from "./style.js";
import { padVisibleEnd, truncateVisible, visibleLength } from "./width.js";
import { commandsOf, servicesOf } from "../config/workspace-items.js";

export type WorkspacePickerState = {
  workspaces: WorkspaceConfig[];
  selectedWorkspaceIndex: number | undefined;
  activeWorkspaceId?: string;
  statusMessage?: string;
  moving?: boolean;
  activeRunningServiceCount?: number;
  // Shows the settings key in the footer.
  settingsAvailable?: boolean;
  // The folder Sable was started in has a sable.json, so the import key is worth showing.
  projectFileHere?: boolean;
};

export type WorkspacePickerResult =
  | { type: "run"; workspace: WorkspaceConfig }
  | { type: "createWorkspace" }
  | { type: "importProject" }
  | { type: "exportProject"; workspace: WorkspaceConfig }
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

// How much of the launch screen is drawn: 0 the logo (building up dot by dot),
// 1 the finished logo and name, 2 everything.
export type StartupStage = 0 | 1 | 2;

// While the logo is still building: how many of its dots are lit, and how many
// of the newest ones still glow.
export type LogoReveal = { revealedDots: number; glowDots: number };

export type RenderWorkspacePickerOptions = {
  stage?: StartupStage;
  reveal?: LogoReveal;
  // One line under the logo, such as "3 workspaces · 7 services".
  summary?: string;
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
  // Runs once at launch, after the startup logo if there is one and before the list appears (e.g. the update popup).
  sound?: SoundControl;
  settings?: SettingsControl;
  projectFileHere?: boolean;
  runSettings?: typeof runSettingsDialog;
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
  const renderStartupMoment = options.renderStartupMoment ?? ((stage: RenderWorkspacePickerOptions) => renderWorkspaceStartupMoment({
    ...stage,
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
    settingsAvailable: options.settings !== undefined,
    projectFileHere: options.projectFileHere,
  };
  let mode: PickerMode = "picker";
  let stateBeforeMove: WorkspacePickerState | undefined;
  let pendingKeyRead: Promise<Awaited<ReturnType<KeyInput["readKey"]>>> | undefined;
  let queuedEvent = await runStartupMoment();

  if (options.afterStartup !== undefined) {
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

    if (isResize(event.keypress)) {
      redraw();
      continue;
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
        options.sound?.play("move");
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
        options.sound?.play("move");
        renderFrame(screen, render(state));
        break;
      case "selectPrevious":
        state = selectPreviousWorkspace(state);
        options.sound?.play("move");
        renderFrame(screen, render(state));
        break;
      case "run": {
        const workspace = getSelectedWorkspace(state);

        if (workspace !== undefined) {
          options.sound?.play("open");
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
      case "importProject":
        return { type: "importProject" };
      case "exportProject": {
        const workspace = getSelectedWorkspace(state);

        if (workspace !== undefined) {
          return { type: "exportProject", workspace };
        }

        break;
      }
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
      case "openHelp":
        mode = "help";
        renderFrame(screen, renderHelp({ background: render(state), columns: process.stdout.columns, rows: process.stdout.rows, color }));
        break;
      case "openSettings": {
        if (options.settings === undefined) {
          break;
        }

        const outcome: SettingsDialogResult = await (options.runSettings ?? runSettingsDialog)({
          settings: options.settings,
          keyInput: options.keyInput,
          background: render(state),
          screen,
          columns: process.stdout.columns,
          rows: process.stdout.rows,
        });

        if (outcome === "exit") {
          return { type: "exit" };
        }

        renderFrame(screen, render(state));
        break;
      }
      case "quit":
        return { type: "exit" };
      case "none":
        break;
    }
  }

  // Draws the current screen again at the terminal's new size.
  function redraw(): void {
    const workspace = getSelectedWorkspace(state);

    screen.clear();

    if (mode === "help") {
      screen.write(`${renderHelp({ background: render(state), columns: process.stdout.columns, rows: process.stdout.rows, color })}\n`);
    } else if (mode === "details" && workspace !== undefined) {
      screen.write(`${renderDetails(workspace)}\n`);
    } else {
      screen.write(`${render(state)}\n`);
    }
  }

  async function runStartupMoment(): Promise<PickerEvent | undefined> {
    const durationMs = options.startupMomentMs ?? 0;

    if (durationMs <= 0) {
      return undefined;
    }

    const summary = describeWorkspaces(options.workspaces);
    let firstFrame = true;
    const show = (frame: RenderWorkspacePickerOptions) => {
      const contents = renderStartupMoment({ ...frame, summary });

      if (firstFrame) {
        renderFrame(screen, contents);
        firstFrame = false;
      } else {
        // Every frame only adds to the last one, so draw over it from the top
        // instead of clearing the screen, which would flicker.
        screen.write(`\x1b[H${contents.split("\n").map((line) => `${line}\x1b[K`).join("\n")}\n`);
      }
    };

    if (!color) {
      show({ stage: 2 });

      const event = await readKeyAbortOrTimeout(durationMs);

      return event.type === "timeout" ? undefined : event;
    }

    // The logo builds up dot by dot for the first half, then the name appears,
    // then the rest. The three parts always add up to the launch time.
    const buildMs = durationMs * 0.55;
    const frames = Math.max(1, Math.ceil(buildMs / revealFrameMs));

    for (let frame = 0; frame < frames; frame += 1) {
      const elapsed = frame * revealFrameMs;
      const revealedDots = Math.floor(easeOut(elapsed / buildMs) * logoDotCount);
      const glowDots = revealedDots - Math.floor(easeOut(Math.max(0, elapsed - glowMs) / buildMs) * logoDotCount);

      show({ stage: 0, reveal: { revealedDots, glowDots } });

      const event = await readKeyAbortOrTimeout(Math.min(revealFrameMs, buildMs));

      if (event.type !== "timeout") {
        return event;
      }
    }

    for (const { stage, ms } of [{ stage: 1 as const, ms: durationMs * 0.15 }, { stage: 2 as const, ms: durationMs * 0.3 }]) {
      show({ stage });

      if (stage === 1) {
        options.sound?.play("open");
      }

      const event = await readKeyAbortOrTimeout(ms);

      if (event.type !== "timeout") {
        return event;
      }
    }

    return undefined;
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
    const total = servicesOf(workspace).length;

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
  const stage = options.stage ?? 2;
  const body = shouldRenderAnsiStartupLogo(options)
    ? renderAnsiStartupBanner(style, options.columns, stage, options.summary, options.reveal)
    : shouldRenderTextStartupBanner(options.columns)
    ? renderTextStartupBanner(style, options.columns, options.summary)
    : renderCompactStartupMoment(style, options.columns, options.summary);
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

// e.g. "Sable 0.3.2": the name in the title style, the version quietly beside it.
function startupTitle(style: TuiStyle): string {
  return `${style.title(product.displayName)} ${style.muted(product.version)}`;
}

// Every stage has the same number of lines, so the logo never jumps while it builds.
function renderAnsiStartupBanner(
  style: TuiStyle,
  columns: number | undefined,
  stage: StartupStage,
  summary: string | undefined,
  reveal: LogoReveal | undefined,
): string[] {
  const logo = stage === 0 && reveal !== undefined ? renderRevealedLogo(reveal.revealedDots, reveal.glowDots) : sableLogoAnsi;

  return [
    ...logo.map((line) => centerVisible(line, columns)),
    "",
    stage >= 1 ? centerVisible(startupTitle(style), columns) : "",
    stage >= 2 ? centerVisible(style.muted("Keyboard-first Workspace Manager"), columns) : "",
    stage >= 2 ? centerVisible(style.muted("─".repeat(sableLogoAnsiWidth)), columns) : "",
    stage >= 2 && summary !== undefined ? centerVisible(style.muted(summary), columns) : "",
  ];
}

function renderTextStartupBanner(style: TuiStyle, columns: number | undefined, summary: string | undefined): string[] {
  return [
    ...startupBannerLines.map((line) => centerVisible(style.title(padVisibleEnd(line, startupBannerWidth)), columns)),
    "",
    centerVisible(startupTitle(style), columns),
    centerVisible(style.muted("Keyboard-first Workspace Manager"), columns),
    centerVisible(style.muted("─".repeat(startupBannerWidth)), columns),
    ...(summary === undefined ? [] : [centerVisible(style.muted(summary), columns)]),
  ];
}

function renderCompactStartupMoment(style: TuiStyle, columns: number | undefined, summary: string | undefined): string[] {
  return [
    centerVisible(style.title(`· ${product.binaryName} ${product.version} ·`), columns),
    "",
    centerVisible(style.muted(summary ?? "workspace ready"), columns),
  ];
}

// What the launch screen says about your setup, in a few words.
export function describeWorkspaces(workspaces: WorkspaceConfig[]): string {
  if (workspaces.length === 0) {
    return "No workspaces yet · press a to create one";
  }

  const services = workspaces.reduce((total, workspace) => total + servicesOf(workspace).length, 0);

  return `${workspaces.length} ${workspaces.length === 1 ? "workspace" : "workspaces"} · ${services} ${services === 1 ? "service" : "services"}`;
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
  const hints = baseKeyHints(state);

  // Settings sits just before the last hint (quit), so narrow terminals trim it first.
  return state.settingsAvailable === true && state.moving !== true
    ? [...hints.slice(0, -1), [",", "settings"], ...hints.slice(-1)]
    : hints;
}

function baseKeyHints(state: WorkspacePickerState): KeyHint[] {
  if (state.moving === true) {
    return [["↑↓", "move"], ["Enter", "done"], ["Esc", "cancel"]];
  }

  if (state.workspaces.length === 0) {
    return [["a", "create your first workspace"], ["?", "help"], ["q", "quit"]];
  }

  if (getSelectedWorkspace(state)?.id === state.activeWorkspaceId) {
    return [["↑↓", "select"], ["Enter", "open"], ["s", "stop"], ["r", "restart"], ["?", "help"], ["q", "quit"]];
  }

  return [
    ["↑↓", "select"],
    ["Enter", "open"],
    ["a", "add"],
    ...(state.projectFileHere === true ? [["i", "import sable.json"] as KeyHint] : []),
    ["e", "rename"],
    ["?", "help"],
    ["q", "quit"],
  ];
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
        "i           set up a workspace from the sable.json in this folder",
        "x           write a sable.json for the selected workspace, to share it",
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
      rows: [",           settings (sound, welcome screen, saved logs)", "q           quit Sable (from this screen)", "Ctrl+C      quit Sable from anywhere"],
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
    ...servicesOf(workspace).map((service) => ({ kind: "service" as const, item: service })),
    ...commandsOf(workspace).map((command) => ({ kind: "command" as const, item: command })),
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

// Frames of the logo build-up (about 25 per second), and how long a new dot glows.
const revealFrameMs = 40;
const glowMs = 100;

function easeOut(progress: number): number {
  const clamped = Math.min(1, Math.max(0, progress));

  return 1 - (1 - clamped) * (1 - clamped);
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
