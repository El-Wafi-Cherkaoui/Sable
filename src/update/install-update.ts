import { spawn } from "node:child_process";
import { updateInstallCommand } from "./update-check.js";

export type InstallUpdateOptions = {
  version: string;
  log?: (message: string) => void;
  run?: (command: string, args: string[]) => Promise<number>;
  platform?: NodeJS.Platform;
};

// Runs the global install in the user's terminal, after Sable has closed its
// screen, so npm's progress and any permission errors are visible. Returns the
// exit code to use for Sable itself.
export async function installUpdate(options: InstallUpdateOptions): Promise<number> {
  const log = options.log ?? ((message) => console.log(message));
  const install = updateInstallCommand();
  const platform = options.platform ?? process.platform;

  log(`Updating Sable to ${options.version}...`);
  log(`$ ${install.display}`);
  log("");

  let exitCode: number;

  try {
    exitCode = await (options.run ?? runInherited)(install.command, install.args);
  } catch {
    exitCode = 1;
  }

  log("");

  if (exitCode === 0) {
    log(`Sable ${options.version} is installed. Run sable to start it.`);
    return 0;
  }

  log(`The update didn't finish (exit code ${exitCode}). You can run it yourself:`);
  log(`  ${install.display}`);

  if (platform !== "win32") {
    log("If npm reported a permissions error (EACCES), your global packages may need sudo:");
    log(`  sudo ${install.display}`);
  }

  return exitCode;
}

function runInherited(command: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    // npm is a .cmd script on Windows, which needs a shell to run.
    const child = spawn(command, args, { stdio: "inherit", shell: process.platform === "win32" });

    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}
