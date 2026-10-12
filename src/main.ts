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
import { claimFullSplash } from "./settings/launch-splash.js";
import { createSettingsStore, settingsFile } from "./settings/settings-store.js";
import { loadSoundControl, type SoundControl } from "./sound/sound-control.js";
import { product } from "./shared/product.js";
import { requireTerminal, TerminalRequiredError } from "./shared/require-terminal.js";
import { installUpdate } from "./update/install-update.js";
import { startUpdateCheck, updateCacheFile, updateInstallCommand } from "./update/update-check.js";
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

const program = new Command();

program
  .name(product.binaryName)
  .description("A keyboard-first terminal workspace manager for developers.")
  .version(product.version)
  .action(async () => {
    try {
      requireTerminal();
    } catch (error) {
      if (error instanceof TerminalRequiredError) {
        console.error(error.message);
        process.exitCode = 1;
        return;
      }

      throw error;
    }

    const configDirectory = resolveConfigPaths().directory;
    const updateCheck = startUpdateCheck({ cacheFile: updateCacheFile(configDirectory) });
    const sound = await loadSoundControl(configDirectory);
    const fullSplash = await claimFullSplash(createSettingsStore(settingsFile(configDirectory)));
    let result: Awaited<ReturnType<typeof runWorkspaceHome>>;

    try {
      result = await runWorkspaceHome({
        store: new ConfigStore(),
        sound,
        startupShort: !fullSplash,
        update: {
          latestVersion: () => updateCheck.newerVersion(),
          currentVersion: product.version,
          installCommand: updateInstallCommand().display,
          dismiss: (version) => updateCheck.dismiss(version),
        },
      });
    } catch (error) {
      if (handleConfigError(error)) {
        return;
      }

      throw error;
    } finally {
      updateCheck.cancel();
      sound.close();
    }

    if (result.type === "update") {
      // Sable's screen is closed by now, so npm's output shows normally.
      process.stdout.write("\x1b[2J\x1b[H");
      process.exitCode = await installUpdate({ version: result.version });
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
    let sound: SoundControl | undefined;

    try {
      requireTerminal();
      sound = await loadSoundControl(resolveConfigPaths().directory);
      await runWorkspaceCommand(workspaceName, {
        store: new ConfigStore(),
        sound,
      });
    } catch (error) {
      if (handleConfigError(error)) {
        return;
      }

      if (error instanceof WorkspaceLookupError || error instanceof TerminalRequiredError) {
        console.error(error.message);
        process.exitCode = 1;
        return;
      }

      throw error;
    } finally {
      sound?.close();
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
