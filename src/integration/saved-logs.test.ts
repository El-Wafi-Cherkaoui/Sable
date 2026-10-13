import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkspaceConfig } from "../config/config-types.js";
import { createLogFiles } from "../logs/log-files.js";
import { createRunWorkspaceController } from "../workspaces/run-workspace.js";

let directory: string;

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "sable-saved-logs-"));
});

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true });
});

function workspace(script: string): WorkspaceConfig {
  return {
    id: "ws_shop",
    name: "shop",
    projectDirectory: directory,
    items: [{
      kind: "service",
      id: "svc_api",
      name: "api",
      command: `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`,
      cwd: directory,
      autoStart: true,
      env: {},
      after: [],
    }],
  };
}

async function waitUntil(predicate: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 3_000;

  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  expect(await predicate()).toBe(true);
}

describe("saved logs, end to end", () => {
  it("saves what a service prints, and shows it again after Sable is restarted", async () => {
    const logs = path.join(directory, "logs");
    const first = createLogFiles({ directory: logs, isEnabled: () => true, flushMs: 5 });
    const controller = createRunWorkspaceController(workspace('console.log("serving on 3000"); console.error("fatal: out of memory"); process.exit(1);'), { logFiles: first });

    await controller.startItem("svc_api");
    await waitUntil(() => controller.getState().items[0]?.process.status === "exited");
    await controller.shutdown();
    await first.close();

    const saved = await fs.readFile(path.join(logs, "shop", "api.log"), "utf8");

    expect(saved).toContain("[system] service started");
    expect(saved).toContain("[stdout] serving on 3000");
    expect(saved).toContain("[stderr] fatal: out of memory");

    // A new run of Sable: the screen starts empty, but the saved output is offered above it.
    const second = createLogFiles({ directory: logs, isEnabled: () => true, flushMs: 5 });
    const restarted = createRunWorkspaceController(workspace("setInterval(() => {}, 1000);"), { logFiles: second });

    restarted.getItemLogs("svc_api");
    await waitUntil(() => restarted.getItemLogs("svc_api").some((entry) => entry.line === "fatal: out of memory"));

    expect(restarted.getItemLogs("svc_api").map((entry) => entry.line)).toEqual([
      "service started",
      "serving on 3000",
      "fatal: out of memory",
      expect.stringContaining("process exited"),
      "saved output above, new output below",
    ]);

    await restarted.shutdown();
    await second.close();
  });

  it("saves nothing while the setting is off", async () => {
    const logs = path.join(directory, "logs");
    const files = createLogFiles({ directory: logs, isEnabled: () => false, flushMs: 5 });
    const controller = createRunWorkspaceController(workspace('console.log("quiet");'), { logFiles: files });

    await controller.startItem("svc_api");
    await waitUntil(() => controller.getState().items[0]?.process.status === "exited");
    await controller.shutdown();
    await files.close();

    await expect(fs.access(logs)).rejects.toThrow();
  });
});
