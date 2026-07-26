import { existsSync, statSync } from "node:fs";
import path from "node:path";
import type { AppConfig, WorkspaceConfig } from "../config/config-types.js";
import type { KeyInput } from "../input/terminal-key-input.js";
import { generateShortId } from "../shared/id.js";
import { runTextPrompt, type PromptScreen } from "../tui/prompt-view.js";
import { hasWorkspaceNamed } from "./create-workspace.js";

export type CreateWorkspaceFlowResult =
  | { type: "completed"; workspaceId: string; message: string }
  | { type: "back"; message: string }
  | { type: "exit" };

export type CreateWorkspaceFlowStore = {
  load(): Promise<AppConfig>;
  save(config: AppConfig): Promise<void>;
};

export type CreateWorkspaceFlowOptions = {
  store: CreateWorkspaceFlowStore;
  keyInput: KeyInput;
  screen?: PromptScreen;
  generateId?: typeof generateShortId;
  projectDirectoryExists?: (directoryPath: string) => boolean;
  defaultProjectDirectory?: string;
};

export async function runCreateWorkspaceFlow(
  options: CreateWorkspaceFlowOptions,
): Promise<CreateWorkspaceFlowResult> {
  const config = await options.store.load();
  const generateId = options.generateId ?? generateShortId;
  const projectDirectoryExists = options.projectDirectoryExists ?? defaultProjectDirectoryExists;

  const nameResult = await runTextPrompt({
    title: "Create workspace",
    message: "Workspace name",
    keyInput: options.keyInput,
    screen: options.screen,
    validate(value) {
      const trimmedValue = value.trim();

      if (trimmedValue.length === 0) {
        return "Workspace name is required.";
      }

      if (!/^[A-Za-z0-9_-]+$/.test(trimmedValue)) {
        return "Workspace names may only contain letters, numbers, dashes, and underscores.";
      }

      if (hasWorkspaceNamed(config, trimmedValue)) {
        return `Workspace "${trimmedValue}" already exists.`;
      }

      return true;
    },
  });
  if (nameResult.type === "back") return { type: "back", message: "Create workspace cancelled." };
  if (nameResult.type === "exit") return { type: "exit" };

  const projectDirectoryResult = await runTextPrompt({
    title: "Create workspace",
    message: "Project directory",
    keyInput: options.keyInput,
    screen: options.screen,
    defaultValue: options.defaultProjectDirectory ?? process.cwd(),
    validate(value) {
      const trimmedValue = value.trim();

      if (trimmedValue.length === 0) {
        return "Project directory is required.";
      }

      if (!projectDirectoryExists(path.resolve(trimmedValue))) {
        return "Project directory must exist and be a directory.";
      }

      return true;
    },
  });
  if (projectDirectoryResult.type === "back") return { type: "back", message: "Create workspace cancelled." };
  if (projectDirectoryResult.type === "exit") return { type: "exit" };

  const workspace: WorkspaceConfig = {
    id: generateId("ws"),
    name: nameResult.value.trim(),
    projectDirectory: path.resolve(projectDirectoryResult.value.trim()),
    services: [],
  };

  await options.store.save({
    ...config,
    workspaces: [...config.workspaces, workspace],
  });

  return {
    type: "completed",
    workspaceId: workspace.id,
    message: `Created workspace "${workspace.name}".`,
  };
}

function defaultProjectDirectoryExists(directoryPath: string): boolean {
  try {
    return existsSync(directoryPath) && statSync(directoryPath).isDirectory();
  } catch {
    return false;
  }
}
