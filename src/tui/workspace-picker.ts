import type { WorkspaceConfig } from "../config/config-types.js";
import { mapWorkspacePickerKey } from "../input/keymap.js";
import type { KeyInput } from "../input/terminal-key-input.js";

export type WorkspacePickerState = {
  workspaces: WorkspaceConfig[];
  selectedWorkspaceIndex: number | undefined;
};

export type WorkspacePickerResult =
  | { type: "run"; workspace: WorkspaceConfig }
  | { type: "addService"; workspace: WorkspaceConfig }
  | { type: "exit" };

export type WorkspacePickerScreen = {
  clear(): void;
  write(contents: string): void;
};

export type RunWorkspacePickerOptions = {
  workspaces: WorkspaceConfig[];
  keyInput: KeyInput;
  abortSignal?: AbortSignal;
  screen?: WorkspacePickerScreen;
  render?: typeof renderWorkspacePicker;
  renderHelp?: typeof renderWorkspacePickerHelp;
  renderDetails?: typeof renderWorkspaceDetails;
};

type PickerMode = "picker" | "help" | "details";
type PickerEvent =
  | { type: "key"; keypress: Awaited<ReturnType<KeyInput["readKey"]>> }
  | { type: "abort" };

export async function runWorkspacePicker(
  options: RunWorkspacePickerOptions,
): Promise<WorkspacePickerResult> {
  const screen = options.screen ?? terminalScreen;
  const render = options.render ?? renderWorkspacePicker;
  const renderHelp = options.renderHelp ?? renderWorkspacePickerHelp;
  const renderDetails = options.renderDetails ?? renderWorkspaceDetails;
  let state = createWorkspacePickerState(options.workspaces);
  let mode: PickerMode = "picker";

  renderFrame(screen, render(state));

  while (true) {
    const event = await readKeyOrAbort(options.keyInput, options.abortSignal);

    if (event.type === "abort" || isCtrlC(event.keypress)) {
      return { type: "exit" };
    }

    if (mode === "help") {
      if (event.keypress.name === "escape" || event.keypress.sequence === "q") {
        mode = "picker";
        renderFrame(screen, render(state));
      }

      continue;
    }

    if (mode === "details") {
      if (event.keypress.name === "escape" || event.keypress.sequence === "q") {
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
      case "addService": {
        const workspace = getSelectedWorkspace(state);

        if (workspace !== undefined) {
          return { type: "addService", workspace };
        }

        break;
      }
      case "openHelp":
        mode = "help";
        renderFrame(screen, renderHelp());
        break;
      case "quit":
        return { type: "exit" };
      case "none":
        break;
    }
  }
}

export function createWorkspacePickerState(
  workspaces: WorkspaceConfig[],
): WorkspacePickerState {
  return {
    workspaces,
    selectedWorkspaceIndex: workspaces.length > 0 ? 0 : undefined,
  };
}

export function selectNextWorkspace(state: WorkspacePickerState): WorkspacePickerState {
  if (state.workspaces.length === 0) {
    return state;
  }

  return {
    ...state,
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
    selectedWorkspaceIndex:
      (selectedWorkspaceIndex - 1 + state.workspaces.length) % state.workspaces.length,
  };
}

export function getSelectedWorkspace(
  state: WorkspacePickerState,
): WorkspaceConfig | undefined {
  if (state.selectedWorkspaceIndex === undefined) {
    return undefined;
  }

  return state.workspaces[state.selectedWorkspaceIndex];
}

export function renderWorkspacePicker(state: WorkspacePickerState): string {
  const lines = ["workspaces", ""];

  if (state.workspaces.length === 0) {
    lines.push("No workspaces found.");
    lines.push("Create one with `sable create <name>`.");
    lines.push("", "? help  q quit");
    return lines.join("\n");
  }

  const nameColumnWidth = Math.max(
    ...state.workspaces.map((workspace) => workspace.name.length),
  );

  for (const [index, workspace] of state.workspaces.entries()) {
    const marker = index === state.selectedWorkspaceIndex ? ">" : " ";
    lines.push(
      `${marker} ${workspace.name.padEnd(nameColumnWidth)}  ${formatServiceCount(
        workspace.services.length,
      )}`,
    );
  }

  lines.push("", "j/k move  Enter run  v view  a add service  ? help  q quit");

  return lines.join("\n");
}

export function renderWorkspacePickerHelp(): string {
  return [
    "workspaces · help",
    "",
    "Navigation",
    "j / Down    select next workspace",
    "k / Up      select previous workspace",
    "",
    "Workspace",
    "Enter       run selected workspace",
    "v           view selected workspace",
    "a           add service to selected workspace",
    "",
    "Global",
    "?           help",
    "q           quit Sable",
    "Ctrl+C      quit Sable",
    "",
    "Esc back",
  ].join("\n");
}

export function renderWorkspaceDetails(workspace: WorkspaceConfig): string {
  const lines = [workspace.name, "", "services"];

  if (workspace.services.length === 0) {
    lines.push("", "No services configured.", "", "Esc back  q back");
    return lines.join("\n");
  }

  for (const service of workspace.services) {
    lines.push(
      "",
      service.name,
      `  command     ${service.command}`,
      `  cwd         ${service.cwd}`,
      `  autoStart   ${service.autoStart ? "yes" : "no"}`,
    );

    const envKeys = Object.keys(service.env);

    if (envKeys.length > 0) {
      lines.push(`  env         ${envKeys.length} ${envKeys.length === 1 ? "variable" : "variables"}`);
    }
  }

  lines.push("", "Esc back  q back");

  return lines.join("\n");
}

function formatServiceCount(count: number): string {
  return `${count} ${count === 1 ? "service" : "services"}`;
}

function isCtrlC(keypress: Awaited<ReturnType<KeyInput["readKey"]>>): boolean {
  return keypress.ctrl === true && keypress.name === "c";
}

async function readKeyOrAbort(
  keyInput: KeyInput,
  abortSignal: AbortSignal | undefined,
): Promise<PickerEvent> {
  return Promise.race([
    keyInput.readKey().then((keypress) => ({ type: "key" as const, keypress })),
    waitForAbort(abortSignal).then(() => ({ type: "abort" as const })),
  ]);
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
