import type { AppConfig, WorkspaceConfig } from "../config/config-types.js";
import type { KeyInput } from "../input/terminal-key-input.js";
import { runTextPrompt, type PromptScreen } from "../tui/prompt-view.js";

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
  const confirmationResult = await runTextPrompt({
    title: "Delete workspace",
    message: `Type "${workspace.name}" to delete this workspace`,
    keyInput: options.keyInput,
    screen: options.screen,
    validate(value) {
      if (value !== workspace.name) {
        return "Name does not match. Try again or press Esc to cancel.";
      }

      return true;
    },
  });

  if (confirmationResult.type === "back") {
    return { type: "back", message: "Delete workspace cancelled." };
  }

  if (confirmationResult.type === "exit") {
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
