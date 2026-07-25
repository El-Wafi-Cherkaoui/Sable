#!/usr/bin/env node

import { Command } from "commander";
import { confirm, input } from "@inquirer/prompts";
import { ConfigStore } from "./config/config-store.js";
import { product } from "./shared/product.js";
import {
  DuplicateWorkspaceNameError,
  runCreateWorkspaceCommand,
} from "./workspaces/create-workspace.js";

const program = new Command();

function printNotImplemented(commandName: string): void {
  console.log(`${product.displayName} ${commandName} is not implemented yet.`);
}

program
  .name(product.binaryName)
  .description("A keyboard-first terminal workspace manager for developers.")
  .version(product.version);

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
  .action(() => {
    printNotImplemented("run");
  });

program
  .command("list")
  .description("list saved workspaces")
  .action(() => {
    printNotImplemented("list");
  });

program
  .command("delete")
  .argument("<workspace-name>", "workspace name")
  .description("delete a saved workspace")
  .action(() => {
    printNotImplemented("delete");
  });

await program.parseAsync();
