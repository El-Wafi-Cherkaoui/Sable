import type { AppConfig, WorkspaceConfig } from "../config/config-types.js";
import type { KeyInput } from "../input/terminal-key-input.js";
import { runDeleteDialog } from "../tui/delete-dialog.js";
import type { PromptScreen } from "../tui/prompt-view.js";

export type DeleteWorkspaceFlowResult =
  | { type: "completed"; selectedWorkspaceId?: string; message: string }
  | { type: "back"; message: string }
  | { type: "exit" };

export type DeleteWorkspaceFlowStore = {
  load(): Promise<AppConfig>;
  save(config: AppConfig): Promise<void>;
};

export type DeleteWorkspaceFlowOptions = {
  store: DeleteWorkspaceFlowStore;
  workspace: WorkspaceConfig;
  keyInput: KeyInput;
  screen?: PromptScreen;
  // The screen the delete was started from, shown dimmed behind the popup.
  background?: string;
  dialog?: typeof runDeleteDialog;
};

export async function runDeleteWorkspaceFlow(
  options: DeleteWorkspaceFlowOptions,
): Promise<DeleteWorkspaceFlowResult> {
  const config = await options.store.load();
  const workspaceIndex = config.workspaces.findIndex(
    (workspace) => workspace.id === options.workspace.id,
  );

  if (workspaceIndex < 0) {
    return { type: "back", message: `Workspace "${options.workspace.name}" was not found.` };
  }

  const workspace = config.workspaces[workspaceIndex];
  const confirmation = await (options.dialog ?? runDeleteDialog)({
    title: "Delete workspace",
    explanation: [
      `This removes "${workspace.name}" and ${describeContents(workspace)} from Sable.`,
      "Your project files stay untouched.",
    ],
    name: workspace.name,
    keyInput: options.keyInput,
    screen: options.screen,
    background: options.background,
  });

  if (confirmation === "back") {
    return { type: "back", message: "Delete workspace cancelled." };
  }

  if (confirmation === "exit") {
    return { type: "exit" };
  }

  const nextWorkspaces = config.workspaces.filter(
    (candidate) => candidate.id !== workspace.id,
  );
  const selectedWorkspaceId = nextWorkspaces.length === 0
    ? undefined
    : nextWorkspaces[Math.min(workspaceIndex, nextWorkspaces.length - 1)]?.id;

  await options.store.save({
    ...config,
    workspaces: nextWorkspaces,
  });

  return {
    type: "completed",
    selectedWorkspaceId,
    message: `Deleted workspace "${workspace.name}".`,
  };
}

function describeContents(workspace: WorkspaceConfig): string {
  const count = (amount: number, noun: string) => `${amount} ${noun}${amount === 1 ? "" : "s"}`;
  const parts = [
    ...(workspace.services.length > 0 ? [count(workspace.services.length, "service")] : []),
    ...((workspace.commands ?? []).length > 0 ? [count(workspace.commands.length, "command")] : []),
  ];

  return parts.length === 0 ? "its settings" : `its ${parts.join(" and ")}`;
}
