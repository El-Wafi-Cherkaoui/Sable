import type { AppConfig } from "../config/config-types.js";

export type WorkspaceConfigStore = {
  load(): Promise<AppConfig>;
  save(config: AppConfig): Promise<void>;
};

export type DeleteWorkspacePrompts = {
  confirm(options: { message: string; default?: boolean }): Promise<boolean>;
};

export type DeleteWorkspaceOutput = {
  log(message: string): void;
};

export type DeleteWorkspaceCommandOptions = {
  store: WorkspaceConfigStore;
  prompts: DeleteWorkspacePrompts;
  output?: DeleteWorkspaceOutput;
};

export class WorkspaceNotFoundError extends Error {
  constructor(name: string) {
    super(`Workspace "${name}" not found.`);
    this.name = "WorkspaceNotFoundError";
  }
}

export async function runDeleteWorkspaceCommand(
  rawWorkspaceName: string,
  options: DeleteWorkspaceCommandOptions,
): Promise<void> {
  const output = options.output ?? console;
  const workspaceName = rawWorkspaceName.trim();
  const config = await options.store.load();
  const workspace = config.workspaces.find(
    (candidate) => normalizeName(candidate.name) === normalizeName(workspaceName),
  );

  if (workspace === undefined) {
    throw new WorkspaceNotFoundError(workspaceName);
  }

  const confirmed = await options.prompts.confirm({
    message: `Delete workspace "${workspace.name}"?`,
    default: false,
  });

  if (!confirmed) {
    output.log("Delete cancelled.");
    return;
  }

  await options.store.save({
    ...config,
    workspaces: config.workspaces.filter(
      (candidate) => candidate.id !== workspace.id,
    ),
  });
  output.log(`Deleted workspace "${workspace.name}".`);
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}
