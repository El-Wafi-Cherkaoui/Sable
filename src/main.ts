#!/usr/bin/env node

import { Command } from "commander";
import { confirm, input } from "@inquirer/prompts";
import {
  ConfigParseError,
  ConfigStore,
  ConfigValidationError,
  formatConfigError,
} from "./config/config-store.js";
import { resolveConfigPaths } from "./config/config-path.js";
import { product } from "./shared/product.js";
import { formatUpdateNotice, startUpdateCheck, updateCacheFile } from "./update/update-check.js";
import {
  DuplicateWorkspaceNameError,
  runCreateWorkspaceCommand,
} from "./workspaces/create-workspace.js";
import {
  runDeleteWorkspaceCommand,
  WorkspaceNotFoundError,
} from "./workspaces/delete-workspace.js";
import { runListWorkspacesCommand } from "./workspaces/list-workspaces.js";
import { WorkspaceLookupError } from "./workspaces/find-workspace.js";
import { runWorkspaceCommand } from "./workspaces/run-workspace.js";
import { runWorkspaceHome } from "./workspaces/workspace-home.js";

function handleConfigError(error: unknown): boolean {
  if (error instanceof ConfigParseError || error instanceof ConfigValidationError) {
    console.error(formatConfigError(error));
    process.exitCode = 1;
    return true;
  }

  return false;
}

// Runs an interactive command with a background check for a newer Sable,
// printing one line about it after the TUI closes.
async function withUpdateCheck(run: (updateNotice: () => string | undefined) => Promise<void>): Promise<void> {
  const updateCheck = startUpdateCheck({ cacheFile: updateCacheFile(resolveConfigPaths().directory) });
  const updateNotice = () => {
    const version = updateCheck.newerVersion();

    return version === undefined ? undefined : formatUpdateNotice(version);
  };

  try {
    await run(updateNotice);
  } finally {
    updateCheck.cancel();

    const notice = updateNotice();

    if (notice !== undefined) {
      console.log(notice);
    }
  }
}

const program = new Command();

program
  .name(product.binaryName)
  .description("A keyboard-first terminal workspace manager for developers.")
  .version(product.version)
  .action(async () => {
    try {
      await withUpdateCheck((updateNotice) => runWorkspaceHome({
        store: new ConfigStore(),
        updateNotice,
      }));
    } catch (error) {
      if (handleConfigError(error)) {
        return;
      }

      throw error;
    }
  });

program
  .command("create")
  .argument("<workspace-name>", "workspace name")
  .description("create a workspace interactively")
  .action(async (workspaceName: string) => {
    try {
      await runCreateWorkspaceCommand(workspaceName, {
        store: new ConfigStore(),
        prompts: { confirm, input },
      });
    } catch (error) {
      if (handleConfigError(error)) {
        return;
      }

      if (error instanceof DuplicateWorkspaceNameError) {
        console.error(error.message);
        process.exitCode = 1;
        return;
      }

      throw error;
    }
  });

program
  .command("run")
  .argument("<workspace-name>", "workspace name")
  .description("run a saved workspace")
  .action(async (workspaceName: string) => {
    try {
      await withUpdateCheck(() => runWorkspaceCommand(workspaceName, {
        store: new ConfigStore(),
      }));
    } catch (error) {
      if (handleConfigError(error)) {
        return;
      }

      if (error instanceof WorkspaceLookupError) {
        console.error(error.message);
        process.exitCode = 1;
        return;
      }

      throw error;
    }
  });

program
  .command("list")
  .description("list saved workspaces")
  .action(async () => {
    try {
      await runListWorkspacesCommand({
        store: new ConfigStore(),
      });
    } catch (error) {
      if (handleConfigError(error)) {
        return;
      }

      throw error;
    }
  });

program
  .command("delete")
  .argument("<workspace-name>", "workspace name")
  .description("delete a saved workspace")
  .action(async (workspaceName: string) => {
    try {
      await runDeleteWorkspaceCommand(workspaceName, {
        store: new ConfigStore(),
        prompts: { confirm },
      });
    } catch (error) {
      if (handleConfigError(error)) {
        return;
      }

      if (error instanceof WorkspaceNotFoundError) {
        console.error(error.message);
        process.exitCode = 1;
        return;
      }

      throw error;
    }
  });

await program.parseAsync();
