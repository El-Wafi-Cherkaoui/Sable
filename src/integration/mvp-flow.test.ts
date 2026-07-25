import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigStore } from "../config/config-store.js";
import type { AppConfig, ServiceConfig } from "../config/config-types.js";
import { WorkspaceController } from "../controller/workspace-controller.js";
import { ProcessManager, type ProcessStatus } from "../process/process-manager.js";
import { runCreateWorkspaceCommand } from "../workspaces/create-workspace.js";
import { runDeleteWorkspaceCommand } from "../workspaces/delete-workspace.js";
import { runListWorkspacesCommand } from "../workspaces/list-workspaces.js";
import { runWorkspaceCommand } from "../workspaces/run-workspace.js";

const tempDirectories: string[] = [];
const processManagers: ProcessManager[] = [];

afterEach(async () => {
  await Promise.all(processManagers.splice(0).map((manager) => manager.stopAll()));
  await Promise.all(
    tempDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("MVP integration flows", () => {
  it("creates, lists, and deletes a workspace through isolated config storage", async () => {
    const projectDirectory = await createTempDirectory();
    const configDirectory = await createTempDirectory();
    const store = new ConfigStore({ directory: configDirectory });
    const output = createOutput();

    await runCreateWorkspaceCommand("shop", {
      store,
      prompts: createPrompts([
        projectDirectory,
        true,
        "api",
        nodeCommand('console.log("ready")'),
        "./api",
        true,
        false,
      ]),
      output,
      generateId: createIdGenerator(["svc_api", "ws_shop"]),
    });

    const createdConfig = await store.load();

    expect(createdConfig.workspaces).toHaveLength(1);
    expect(createdConfig.workspaces[0]).toMatchObject({
      id: "ws_shop",
      name: "shop",
      services: [
        {
          id: "svc_api",
          name: "api",
          cwd: path.join(projectDirectory, "api"),
          autoStart: true,
        },
      ],
    });

    output.log.mockClear();
    await runListWorkspacesCommand({ store, output });
    expect(output.log).toHaveBeenCalledWith("shop  1 service");

    await runDeleteWorkspaceCommand("SHOP", {
      store,
      prompts: { confirm: vi.fn(async () => true) },
      output,
    });

    await expect(store.load()).resolves.toEqual({ version: 1, workspaces: [] });
  });

  it("runs a real service through controller/process manager and captures logs", async () => {
    const processManager = createProcessManager();
    const controller = new WorkspaceController({
      workspace: {
        id: "ws_runtime",
        name: "runtime",
        services: [
          createService({
            id: "svc_api",
            command: nodeCommand('console.log("ready"); setInterval(() => {}, 1000);'),
          }),
        ],
      },
      processManager,
    });

    await controller.startSelectedService();

    await waitUntil(() =>
      controller.getSelectedServiceLogs().some((entry) => entry.line === "ready"),
    );
    expect(controller.getState().services[0]?.process.status).toBe("running");
    expect(controller.getSelectedServiceLogs()).toEqual(
      expect.arrayContaining([
        { stream: "system", line: "service started", timestamp: expect.any(Date) },
        { stream: "stdout", line: "ready", timestamp: expect.any(Date) },
      ]),
    );

    await controller.stopSelectedService();

    expect(controller.getState().services[0]?.process.status).toBe("stopped");
    expect(controller.getSelectedServiceLogs().map((entry) => entry.line)).toContain(
      "service stopped",
    );
  });

  it("runs workspace command cleanup against a real auto-start service", async () => {
    const readyFile = path.join(await createTempDirectory(), "ready.txt");
    const store = createStore({
      version: 1,
      workspaces: [
        {
          id: "ws_cleanup",
          name: "cleanup",
          services: [
            createService({
              id: "svc_cleanup",
              command: nodeCommand(
                `require("node:fs").writeFileSync(${JSON.stringify(
                  readyFile,
                )}, "ready"); setInterval(() => {}, 1000);`,
              ),
              autoStart: true,
            }),
          ],
        },
      ],
    });
    const keyInput = {
      readKey: vi.fn(async () => ({ sequence: "q" })),
      close: vi.fn(),
    };

    await runWorkspaceCommand("cleanup", {
      store,
      keyInput,
      runDashboard: async () => {
        await waitUntil(async () => fileExists(readyFile));
      },
    });

    expect(keyInput.close).toHaveBeenCalledOnce();
    await expect(fileExists(readyFile)).resolves.toBe(true);
  });
});

function createProcessManager(): ProcessManager {
  const processManager = new ProcessManager({
    gracefulStopTimeoutMs: 250,
    forceStopTimeoutMs: 250,
  });

  processManagers.push(processManager);

  return processManager;
}

function createStore(config: AppConfig) {
  return {
    async load() {
      return config;
    },
  };
}

function createOutput() {
  return {
    log: vi.fn(),
    error: vi.fn(),
  };
}

function createPrompts(values: Array<string | boolean>) {
  const nextValue = () => {
    const value = values.shift();

    if (value === undefined) {
      throw new Error("No integration prompt value was provided.");
    }

    return value;
  };

  return {
    async confirm() {
      const value = nextValue();

      if (typeof value !== "boolean") {
        throw new TypeError("Expected a boolean integration prompt value.");
      }

      return value;
    },
    async input(options: { validate?: (value: string) => boolean | string }) {
      const value = nextValue();

      if (typeof value !== "string") {
        throw new TypeError("Expected a string integration prompt value.");
      }

      const validationResult = options.validate?.(value);

      if (validationResult !== undefined && validationResult !== true) {
        throw new Error(validationResult);
      }

      return value;
    },
  };
}

function createIdGenerator(ids: string[]) {
  return vi.fn(() => {
    const id = ids.shift();

    if (id === undefined) {
      throw new Error("No integration id was provided.");
    }

    return id;
  });
}

function createService(overrides: Partial<ServiceConfig> = {}): ServiceConfig {
  return {
    id: "svc_service",
    name: "service",
    command: nodeCommand("process.exit(0);"),
    cwd: process.cwd(),
    autoStart: false,
    env: {},
    ...overrides,
  };
}

function nodeCommand(script: string): string {
  return `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`;
}

async function createTempDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sable-integration-"));
  tempDirectories.push(directory);

  return directory;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(predicate: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 2_000;

  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  expect(await predicate()).toBe(true);
}
