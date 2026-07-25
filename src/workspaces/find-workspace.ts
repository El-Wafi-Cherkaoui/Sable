import type { AppConfig, WorkspaceConfig } from "../config/config-types.js";

export class WorkspaceLookupError extends Error {
  constructor(name: string) {
    super(`Workspace "${name}" not found.`);
    this.name = "WorkspaceLookupError";
  }
}

export function findWorkspaceByName(
  config: AppConfig,
  rawWorkspaceName: string,
): WorkspaceConfig | undefined {
  const workspaceName = normalizeName(rawWorkspaceName);

  return config.workspaces.find(
    (workspace) => normalizeName(workspace.name) === workspaceName,
  );
}

export function requireWorkspaceByName(
  config: AppConfig,
  rawWorkspaceName: string,
): WorkspaceConfig {
  const workspaceName = rawWorkspaceName.trim();
  const workspace = findWorkspaceByName(config, workspaceName);

  if (workspace === undefined) {
    throw new WorkspaceLookupError(workspaceName);
  }

  return workspace;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}
