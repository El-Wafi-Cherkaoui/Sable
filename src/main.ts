#!/usr/bin/env node

import path from "node:path";
import { Command } from "commander";
import { confirm, input } from "@inquirer/prompts";
import {
  ConfigParseError,
  ConfigStore,
  ConfigValidationError,
  formatConfigError,
} from "./config/config-store.js";
import { resolveConfigPaths } from "./config/config-path.js";
import { upgradeNoticeParagraphs } from "./config/upgrade-notice.js";
import { createLogFiles, type LogFiles } from "./logs/log-files.js";
import { loadSettingsControl, type SettingsControl } from "./settings/settings-control.js";
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

// Saved logs are written only while the "Save logs" setting is on, and can be switched at any time.
function logFilesFor(settings: SettingsControl, configDirectory: string): LogFiles {
  return createLogFiles({
    directory: settings.logsDirectory ?? path.join(configDirectory, "logs"),
    isEnabled: () => settings.persistLogs.isEnabled(),
  });
}

// Every command reads the workspaces file through one of these, so that a file found in the old
// format is announced once, by whichever command met it first.
const openedStores: ConfigStore[] = [];

function openStore(): ConfigStore {
  const store = new ConfigStore();

  openedStores.push(store);

  return store;
}

// The TUI shows this as a popup; the other commands (and a TUI that closed before showing it) print it.
function printUpgradeNotices(): void {
  for (const store of openedStores) {
    const notice = store.takeUpgradeNotice();

    if (notice !== undefined) {
      console.error(["", ...upgradeNoticeParagraphs(notice).map((line) => line === "" ? "" : `sable: ${line}`), ""].join("\n"));
    }
  }
}

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
    const settings = await loadSettingsControl(configDirectory);
    const { sound } = settings;
    const logFiles = logFilesFor(settings, configDirectory);
    let result: Awaited<ReturnType<typeof runWorkspaceHome>>;

    try {
      result = await runWorkspaceHome({
        store: openStore(),
        launchDirectory: process.cwd(),
        logFiles,
        sound,
        settings,
        welcomeScreen: settings.welcomeScreen.isEnabled(),
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
      await logFiles.close();
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
        store: openStore(),
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
    let settings: SettingsControl | undefined;
    let logFiles: LogFiles | undefined;

    try {
      requireTerminal();
      const configDirectory = resolveConfigPaths().directory;

      settings = await loadSettingsControl(configDirectory);
      logFiles = logFilesFor(settings, configDirectory);
      await runWorkspaceCommand(workspaceName, {
        store: openStore(),
        logFiles,
        sound: settings.sound,
        settings,
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
      settings?.sound.close();
      await logFiles?.close();
    }
  });

program
  .command("list")
  .description("list saved workspaces")
  .action(async () => {
    try {
      await runListWorkspacesCommand({
        store: openStore(),
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
        store: openStore(),
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
printUpgradeNotices();
