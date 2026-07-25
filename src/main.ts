#!/usr/bin/env node

import { Command } from "commander";
import { product } from "./shared/product.js";

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
  .action(() => {
    printNotImplemented("create");
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

program.parse();
