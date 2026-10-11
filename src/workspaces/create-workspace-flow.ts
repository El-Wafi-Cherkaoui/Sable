import { existsSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AppConfig, WorkspaceConfig } from "../config/config-types.js";
import type { KeyInput } from "../input/terminal-key-input.js";
import { generateShortId } from "../shared/id.js";
import { runForm } from "../tui/form-view.js";
import type { PromptScreen } from "../tui/prompt-view.js";
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
  form?: typeof runForm;
};

export async function runCreateWorkspaceFlow(
  options: CreateWorkspaceFlowOptions,
): Promise<CreateWorkspaceFlowResult> {
  const config = await options.store.load();
  const generateId = options.generateId ?? generateShortId;
  const projectDirectoryExists = options.projectDirectoryExists ?? defaultProjectDirectoryExists;
  const defaultDirectory = options.defaultProjectDirectory ?? getDefaultProjectDirectory();

  const result = await (options.form ?? runForm)({
    title: "New workspace",
    fields: () => [
      { type: "text", key: "name", label: "Name", hint: "Letters, numbers, dashes and underscores, e.g. shop-api" },
      { type: "text", key: "folder", label: "Folder", hint: "Where the project lives; services run from here" },
    ],
    values: { name: defaultWorkspaceName(defaultDirectory, config), folder: defaultDirectory },
    validate(values) {
      const errors: Record<string, string> = {};
      const name = typeof values.name === "string" ? values.name.trim() : "";
      const folder = typeof values.folder === "string" ? values.folder.trim() : "";

      if (name === "") {
        errors.name = "Name is required.";
      } else if (!/^[A-Za-z0-9_-]+$/.test(name)) {
        errors.name = "Use only letters, numbers, dashes, and underscores.";
      } else if (hasWorkspaceNamed(config, name)) {
        errors.name = `A workspace named "${name}" already exists.`;
      }

      if (folder === "") {
        errors.folder = "Folder is required.";
      } else if (!projectDirectoryExists(path.resolve(expandHome(folder)))) {
        errors.folder = "This folder doesn't exist.";
      }

      return errors;
    },
    keyInput: options.keyInput,
    screen: options.screen,
  });

  if (result.type === "back") return { type: "back", message: "Create workspace cancelled." };
  if (result.type === "exit") return { type: "exit" };

  const workspace: WorkspaceConfig = {
    id: generateId("ws"),
    name: String(result.values.name).trim(),
    projectDirectory: path.resolve(expandHome(String(result.values.folder).trim())),
    services: [],
    commands: [],
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

// Suggests the folder's name when it's a valid, unused workspace name.
function defaultWorkspaceName(directory: string, config: AppConfig): string {
  const name = path.basename(directory).replace(/[^A-Za-z0-9_-]/g, "-");

  return /^[A-Za-z0-9_-]+$/.test(name) && !hasWorkspaceNamed(config, name) ? name : "";
}

function expandHome(folder: string): string {
  return folder === "~" || folder.startsWith(`~${path.sep}`) || folder.startsWith("~/")
    ? path.join(os.homedir(), folder.slice(1))
    : folder;
}

function defaultProjectDirectoryExists(directoryPath: string): boolean {
  try {
    return existsSync(directoryPath) && statSync(directoryPath).isDirectory();
  } catch {
    return false;
  }
}

function getDefaultProjectDirectory(): string {
  try {
    return process.cwd();
  } catch {
    try {
      return os.homedir() || "";
    } catch {
      return "";
    }
  }
}
