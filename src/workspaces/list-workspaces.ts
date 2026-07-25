import type { AppConfig } from "../config/config-types.js";

export type WorkspaceConfigReader = {
  load(): Promise<AppConfig>;
};

export type ListWorkspacesOutput = {
  log(message: string): void;
};

export type ListWorkspacesCommandOptions = {
  store: WorkspaceConfigReader;
  output?: ListWorkspacesOutput;
};

export async function runListWorkspacesCommand(
  options: ListWorkspacesCommandOptions,
): Promise<void> {
  const output = options.output ?? console;
  const config = await options.store.load();

  if (config.workspaces.length === 0) {
    output.log("No workspaces found.");
    return;
  }

  const nameColumnWidth = Math.max(
    ...config.workspaces.map((workspace) => workspace.name.length),
  );

  for (const workspace of config.workspaces) {
    output.log(
      `${workspace.name.padEnd(nameColumnWidth)}  ${formatServiceCount(
        workspace.services.length,
      )}`,
    );
  }
}

function formatServiceCount(count: number): string {
  return `${count} ${count === 1 ? "service" : "services"}`;
}
