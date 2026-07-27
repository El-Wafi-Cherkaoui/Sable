import type { AppConfig, WorkspaceConfig } from "../config/config-types.js";
import type { KeyInput } from "../input/terminal-key-input.js";
import { runTextPrompt, type PromptScreen } from "../tui/prompt-view.js";

export type RenameWorkspaceFlowResult =
  | { type: "completed"; workspaceId: string; message: string }
  | { type: "back"; message: string }
  | { type: "exit" };

export type RenameWorkspaceFlowStore = {
  load(): Promise<AppConfig>;
  save(config: AppConfig): Promise<void>;
};

export type RenameWorkspaceFlowOptions = {
  store: RenameWorkspaceFlowStore;
  workspace: WorkspaceConfig;
  keyInput: KeyInput;
  screen?: PromptScreen;
};

export async function runRenameWorkspaceFlow(
  options: RenameWorkspaceFlowOptions,
): Promise<RenameWorkspaceFlowResult> {
  const config = await options.store.load();
  const workspace = config.workspaces.find((candidate) => candidate.id === options.workspace.id);

  if (workspace === undefined) {
    return { type: "back", message: `Workspace "${options.workspace.name}" was not found.` };
  }

  const nameResult = await runTextPrompt({
    title: "Rename workspace",
    message: "Workspace name",
    keyInput: options.keyInput,
    screen: options.screen,
    defaultValue: workspace.name,
    validate(value) {
      const trimmedValue = value.trim();

      if (trimmedValue.length === 0) {
        return "Workspace name is required.";
      }

      if (!/^[A-Za-z0-9_-]+$/.test(trimmedValue)) {
        return "Workspace names may only contain letters, numbers, dashes, and underscores.";
      }

      if (config.workspaces.some((candidate) =>
        candidate.id !== workspace.id && normalizeName(candidate.name) === normalizeName(trimmedValue)
      )) {
        return `Workspace "${trimmedValue}" already exists.`;
      }

      return true;
    },
  });

  if (nameResult.type === "back") {
    return { type: "back", message: "Rename workspace cancelled." };
  }

  if (nameResult.type === "exit") {
    return { type: "exit" };
  }

  const nextWorkspace = { ...workspace, name: nameResult.value.trim() };

  await options.store.save({
    ...config,
    workspaces: config.workspaces.map((candidate) =>
      candidate.id === workspace.id ? nextWorkspace : candidate,
    ),
  });

  return {
    type: "completed",
    workspaceId: workspace.id,
    message: `Renamed workspace "${workspace.name}" to "${nextWorkspace.name}".`,
  };
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}