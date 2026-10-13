import type { KeyInput } from "../input/terminal-key-input.js";
import type { LogFiles, LogTarget } from "../logs/log-files.js";
import { runSavedLogsDialog, type SavedLogRow, type SavedLogsDialogResult } from "../tui/saved-logs-dialog.js";
import type { PromptScreen } from "../tui/prompt-view.js";
import type { RunWorkspaceController } from "./run-workspace.js";

type SavedLogsFlowBase = {
  logFiles: LogFiles;
  keyInput: KeyInput;
  screen?: PromptScreen;
  // The screen the popup opens over.
  background?: string;
  // True while Sable is writing logs; when false the popup says what it lists are older files.
  saving: boolean;
  dialog?: typeof runSavedLogsDialog;
};

const savingOffNote = "Saving logs is off. These are files from earlier.";

// Lets the user delete the saved logs of one item of the open workspace, or all of its items.
export async function runWorkspaceSavedLogs(
  options: SavedLogsFlowBase & { controller: RunWorkspaceController },
): Promise<SavedLogsDialogResult> {
  const { logFiles, controller } = options;
  const workspace = () => controller.getState().workspace.name;
  const items = () => controller.getState().items.map(({ item }) => ({
    id: item.id,
    label: item.kind === "command" ? `${item.name} (command)` : item.name,
    target: { workspace: workspace(), name: item.name, kind: item.kind } satisfies LogTarget,
  }));

  return (options.dialog ?? runSavedLogsDialog)({
    title: `Saved logs · ${workspace()}`,
    note: options.saving ? undefined : savingOffNote,
    async load(): Promise<SavedLogRow[]> {
      const rows: SavedLogRow[] = [{ label: "Everything in this workspace", bytes: (await logFiles.workspaceUsage(workspace())).bytes }];

      for (const item of items()) {
        rows.push({ label: item.label, bytes: (await logFiles.usage(item.target)).bytes });
      }

      return rows;
    },
    async remove(index) {
      if (index === 0) {
        await logFiles.removeWorkspace(workspace());
        controller.clearEarlierOutput();

        return;
      }

      const item = items()[index - 1];

      if (item !== undefined) {
        await logFiles.remove([item.target]);
        controller.clearEarlierOutput([item.id]);
      }
    },
    keyInput: options.keyInput,
    screen: options.screen,
    background: options.background,
  });
}

// From the workspace list: delete the saved logs of one workspace, or of everything.
export async function runAllSavedLogs(
  options: SavedLogsFlowBase & {
    workspaces: Array<{ name: string }>;
    // The workspace that is running, whose on-screen copy of earlier output must be forgotten too.
    active?: { name: string; controller: RunWorkspaceController };
  },
): Promise<SavedLogsDialogResult> {
  const { logFiles, active } = options;

  return (options.dialog ?? runSavedLogsDialog)({
    title: "Saved logs",
    note: options.saving ? undefined : savingOffNote,
    async load(): Promise<SavedLogRow[]> {
      const rows: SavedLogRow[] = [{ label: "Everything", bytes: (await logFiles.totalUsage()).bytes }];

      for (const workspace of options.workspaces) {
        rows.push({ label: workspace.name, bytes: (await logFiles.workspaceUsage(workspace.name)).bytes });
      }

      return rows;
    },
    async remove(index) {
      if (index === 0) {
        await logFiles.removeAll();
        active?.controller.clearEarlierOutput();

        return;
      }

      const workspace = options.workspaces[index - 1];

      if (workspace !== undefined) {
        await logFiles.removeWorkspace(workspace.name);

        if (active?.name === workspace.name) {
          active.controller.clearEarlierOutput();
        }
      }
    },
    keyInput: options.keyInput,
    screen: options.screen,
    background: options.background,
  });
}
