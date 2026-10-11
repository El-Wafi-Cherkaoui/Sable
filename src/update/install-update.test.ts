import { describe, expect, it, vi } from "vitest";
import { installUpdate } from "./install-update.js";

describe("installUpdate", () => {
  it("runs the global install and says how to start the new version", async () => {
    const log = vi.fn();
    const run = vi.fn(async () => 0);

    await expect(installUpdate({ version: "0.4.0", log, run, platform: "linux" })).resolves.toBe(0);

    expect(run).toHaveBeenCalledWith("npm", ["install", "-g", "sable-workspaces@latest"]);
    expect(log).toHaveBeenCalledWith("$ npm install -g sable-workspaces@latest");
    expect(log).toHaveBeenLastCalledWith("Sable 0.4.0 is installed. Run sable to start it.");
  });

  it("explains how to finish by hand when npm fails, including sudo on macOS and Linux", async () => {
    const log = vi.fn();

    await expect(installUpdate({ version: "0.4.0", log, run: async () => 243, platform: "darwin" })).resolves.toBe(243);

    const output = log.mock.calls.map(([line]) => line).join("\n");

    expect(output).toContain("The update didn't finish (exit code 243). You can run it yourself:");
    expect(output).toContain("  sudo npm install -g sable-workspaces@latest");
  });

  it("does not suggest sudo on Windows, and survives npm not starting at all", async () => {
    const log = vi.fn();

    await expect(installUpdate({ version: "0.4.0", log, run: async () => { throw new Error("ENOENT"); }, platform: "win32" })).resolves.toBe(1);
    expect(log.mock.calls.map(([line]) => line).join("\n")).not.toContain("sudo");
  });
});
