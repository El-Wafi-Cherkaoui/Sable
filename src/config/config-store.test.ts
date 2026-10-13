import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConfigParseError,
  ConfigStore,
  ConfigValidationError,
  defaultConfig,
  formatConfigError,
} from "./config-store.js";

let tempDirectory: string;

beforeEach(async () => {
  tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "sable-config-store-"));
});

afterEach(async () => {
  await fs.rm(tempDirectory, { recursive: true, force: true });
});

describe("ConfigStore", () => {
  it("returns the default config when the config file does not exist", async () => {
    const store = new ConfigStore({ directory: tempDirectory });

    await expect(store.load()).resolves.toEqual(defaultConfig);
  });

  it("saves and loads a valid config", async () => {
    const store = new ConfigStore({ directory: tempDirectory });
    const config = {
      version: 2 as const,
      workspaces: [
        {
          id: "workspace-1",
          name: "ecommerce",
          projectDirectory: "/projects/ecommerce",
          items: [
            {
              kind: "service" as const,
              after: [],
              id: "service-1",
              name: "backend",
              command: "npm run dev",
              cwd: "/projects/ecommerce/backend",
              autoStart: true,
              env: {
                NODE_ENV: "development",
              },
            },
          ],
        },
      ],
    };

    await store.save(config);

    await expect(store.load()).resolves.toEqual(config);
  });

  it("loads older workspaces without projectDirectory by inferring from the first service", async () => {
    const store = new ConfigStore({ directory: tempDirectory });

    await fs.writeFile(
      store.paths.file,
      JSON.stringify({
        version: 1,
        workspaces: [
          {
            id: "workspace-1",
            name: "ecommerce",
            services: [
              {
                id: "service-1",
                name: "backend",
                command: "npm run dev",
                cwd: "/projects/ecommerce/backend",
                autoStart: true,
                env: {},
              },
            ],
          },
        ],
      }),
      "utf8",
    );

    await expect(store.load()).resolves.toEqual({
      version: 2,
      workspaces: [
        {
          id: "workspace-1",
          name: "ecommerce",
          projectDirectory: path.resolve("/projects/ecommerce/backend"),
          items: [
            {
              kind: "service",
              after: [],
              id: "service-1",
              name: "backend",
              command: "npm run dev",
              cwd: "/projects/ecommerce/backend",
              autoStart: true,
              env: {},
            },
          ],
        },
      ],
    });
  });

  it("loads older empty workspaces without projectDirectory by using the current directory", async () => {
    const store = new ConfigStore({ directory: tempDirectory });

    await fs.writeFile(
      store.paths.file,
      JSON.stringify({
        version: 1,
        workspaces: [
          {
            id: "workspace-1",
            name: "empty",
            services: [],
          },
        ],
      }),
      "utf8",
    );

    await expect(store.load()).resolves.toEqual({
      version: 2,
      workspaces: [
        {
          id: "workspace-1",
          name: "empty",
          projectDirectory: process.cwd(),
          items: [],
        },
      ],
    });
  });

  describe("upgrading a version 1 file", () => {
    const service = { id: "svc-1", name: "api", command: "npm run dev", cwd: "/projects/shop", autoStart: true, env: {} };
    const command = { id: "cmd-1", name: "build", command: "npm run build", cwd: "/projects/shop", env: {} };
    const version1 = {
      version: 1,
      workspaces: [{ id: "ws-1", name: "shop", projectDirectory: "/projects/shop", services: [service], commands: [command] }],
    };

    it("joins services and commands into one list, services first, each with its kind", async () => {
      const store = new ConfigStore({ directory: tempDirectory });

      await fs.writeFile(store.paths.file, JSON.stringify(version1), "utf8");

      await expect(store.load()).resolves.toEqual({
        version: 2,
        workspaces: [{
          id: "ws-1",
          name: "shop",
          projectDirectory: "/projects/shop",
          items: [{ kind: "service", after: [], ...service }, { kind: "command", after: [], ...command }],
        }],
      });
    });

    it("accepts a version 1 workspace that has no commands list", async () => {
      const store = new ConfigStore({ directory: tempDirectory });
      const { commands: _commands, ...withoutCommands } = version1.workspaces[0]!;

      await fs.writeFile(store.paths.file, JSON.stringify({ version: 1, workspaces: [withoutCommands] }), "utf8");

      const config = await store.load();

      expect(config.workspaces[0]?.items).toEqual([{ kind: "service", after: [], ...service }]);
    });

    it("keeps a copy of the original file and leaves the file itself alone until a save", async () => {
      const store = new ConfigStore({ directory: tempDirectory });
      const original = JSON.stringify(version1);

      await fs.writeFile(store.paths.file, original, "utf8");
      await store.load();

      await expect(fs.readFile(`${store.paths.file}.bak-0.3`, "utf8")).resolves.toBe(original);
      await expect(fs.readFile(store.paths.file, "utf8")).resolves.toBe(original);
    });

    it("writes version 2 on the next save without touching the backup", async () => {
      const store = new ConfigStore({ directory: tempDirectory });
      const original = JSON.stringify(version1);

      await fs.writeFile(store.paths.file, original, "utf8");
      await store.save(await store.load());

      const saved = JSON.parse(await fs.readFile(store.paths.file, "utf8")) as { version: number; workspaces: Array<{ items: unknown[]; services?: unknown }> };

      expect(saved.version).toBe(2);
      expect(saved.workspaces[0]?.items).toHaveLength(2);
      expect(saved.workspaces[0]?.services).toBeUndefined();
      await expect(fs.readFile(`${store.paths.file}.bak-0.3`, "utf8")).resolves.toBe(original);
    });

    it("does not replace an existing backup", async () => {
      const store = new ConfigStore({ directory: tempDirectory });

      await fs.writeFile(store.paths.file, JSON.stringify(version1), "utf8");
      await fs.writeFile(`${store.paths.file}.bak-0.3`, "older backup", "utf8");
      await store.load();

      await expect(fs.readFile(`${store.paths.file}.bak-0.3`, "utf8")).resolves.toBe("older backup");
    });

    it("hands out the upgrade news once, when it made the copy", async () => {
      const store = new ConfigStore({ directory: tempDirectory });

      await fs.writeFile(store.paths.file, JSON.stringify(version1), "utf8");
      expect(store.takeUpgradeNotice()).toBeUndefined();

      await store.load();
      await store.load();

      expect(store.takeUpgradeNotice()).toEqual({ backupFile: `${store.paths.file}.bak-0.3`, backedUp: true });
      expect(store.takeUpgradeNotice()).toBeUndefined();
    });

    it("does not announce it again on a later run, when the copy is already there", async () => {
      const first = new ConfigStore({ directory: tempDirectory });

      await fs.writeFile(first.paths.file, JSON.stringify(version1), "utf8");
      await first.load();
      first.takeUpgradeNotice();

      const second = new ConfigStore({ directory: tempDirectory });

      await second.load();

      expect(second.takeUpgradeNotice()).toBeUndefined();
    });

    it("says so when the copy could not be made", async () => {
      const store = new ConfigStore({ directory: tempDirectory });
      const copy = vi.spyOn(fs, "copyFile").mockRejectedValue(Object.assign(new Error("read-only"), { code: "EACCES" }));

      try {
        await fs.writeFile(store.paths.file, JSON.stringify(version1), "utf8");
        await store.load();

        expect(store.takeUpgradeNotice()).toEqual({ backupFile: `${store.paths.file}.bak-0.3`, backedUp: false });
      } finally {
        copy.mockRestore();
      }
    });

    it("has no news for a file that is already version 2", async () => {
      const store = new ConfigStore({ directory: tempDirectory });

      await store.save({ version: 2, workspaces: [] });
      await store.load();

      expect(store.takeUpgradeNotice()).toBeUndefined();
    });

    it("makes no backup for a file that is already version 2", async () => {
      const store = new ConfigStore({ directory: tempDirectory });

      await store.save({ version: 2, workspaces: [] });
      await store.load();

      await expect(fs.access(`${store.paths.file}.bak-0.3`)).rejects.toThrow();
    });
  });

  it("throws a parse error for malformed JSON", async () => {
    const store = new ConfigStore({ directory: tempDirectory });

    await fs.writeFile(store.paths.file, "{ not json", "utf8");

    await expect(store.load()).rejects.toBeInstanceOf(ConfigParseError);
  });

  it("throws a validation error for invalid config", async () => {
    const store = new ConfigStore({ directory: tempDirectory });

    await fs.writeFile(
      store.paths.file,
      JSON.stringify({ version: 3, workspaces: [] }),
      "utf8",
    );

    await expect(store.load()).rejects.toBeInstanceOf(ConfigValidationError);
  });

  it("creates the config directory when saving", async () => {
    const missingDirectory = path.join(tempDirectory, "missing", "config");
    const store = new ConfigStore({ directory: missingDirectory });

    await store.save(defaultConfig);

    const stats = await fs.stat(missingDirectory);

    expect(stats.isDirectory()).toBe(true);
  });

  it("writes the final config file and leaves no temp files after save", async () => {
    const store = new ConfigStore({ directory: tempDirectory });

    await store.save(defaultConfig);

    const entries = await fs.readdir(tempDirectory);

    expect(entries).toEqual(["workspaces.json"]);
    await expect(fs.readFile(store.paths.file, "utf8")).resolves.toBe(
      `${JSON.stringify(defaultConfig, null, 2)}\n`,
    );
  });

  it("cleans up the temp file when the atomic rename fails", async () => {
    const store = new ConfigStore({ directory: tempDirectory });

    await fs.mkdir(store.paths.file);

    await expect(store.save(defaultConfig)).rejects.toThrow();

    const entries = await fs.readdir(tempDirectory);

    expect(entries).toEqual(["workspaces.json"]);
  });
});

describe("formatConfigError", () => {
  it("lists zod issues for validation errors", async () => {
    const store = new ConfigStore({ directory: tempDirectory });

    await fs.writeFile(
      store.paths.file,
      JSON.stringify({ version: 1, workspaces: [{ id: "a", name: "bad name!" }] }),
      "utf8",
    );

    const error = await store.load().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConfigValidationError);

    const lines = formatConfigError(error as ConfigValidationError).split("\n");

    expect(lines[0]).toBe(`Invalid config at ${store.paths.file}.`);
    expect(lines.some((line) => line.startsWith("  - workspaces.0."))).toBe(true);
    expect(lines.at(-1)).toBe("Fix or remove the file and run sable again.");
  });

  it("omits the path prefix when an issue has an empty path", async () => {
    const store = new ConfigStore({ directory: tempDirectory });

    await fs.writeFile(store.paths.file, "42", "utf8");

    const error = await store.load().catch((caught: unknown) => caught);
    const lines = formatConfigError(error as ConfigValidationError).split("\n");

    expect(lines[1]).toMatch(/^  - [^:]/);
    expect(lines[1]).not.toMatch(/^  - : /);
  });

  it("includes the JSON syntax error for parse errors", () => {
    const cause = new SyntaxError("Unexpected token } in JSON at position 3");
    const error = new ConfigParseError("/tmp/workspaces.json", cause);

    expect(formatConfigError(error)).toBe(
      [
        "Could not parse config JSON at /tmp/workspaces.json.",
        "  Unexpected token } in JSON at position 3",
        "Fix or remove the file and run sable again.",
      ].join("\n"),
    );
  });

  describe("saving while another Sable instance changed the file", () => {
    function workspace(id: string, command = "npm run dev") {
      return {
        id,
        name: id,
        projectDirectory: `/projects/${id}`,
        items: [{ kind: "service" as const, after: [], id: `${id}-svc`, name: "app", command, cwd: `/projects/${id}`, autoStart: true, env: {} }],
      };
    }

    async function setup(...ids: string[]) {
      const first = new ConfigStore({ directory: tempDirectory });
      const second = new ConfigStore({ directory: tempDirectory });

      await first.save({ version: 2, workspaces: ids.map((id) => workspace(id)) });

      return { first, second };
    }

    it("keeps a workspace the other instance added", async () => {
      const { first, second } = await setup("a");
      const firstView = await first.load();
      const secondView = await second.load();

      await second.save({ ...secondView, workspaces: [...secondView.workspaces, workspace("b")] });
      await first.save({ ...firstView, workspaces: [workspace("a", "npm start")] });

      const saved = await new ConfigStore({ directory: tempDirectory }).load();

      expect(saved.workspaces.map((item) => item.id)).toEqual(["a", "b"]);
      expect(saved.workspaces[0]?.items[0]?.command).toBe("npm start");
    });

    it("keeps the other instance's edit to a workspace this one did not touch", async () => {
      const { first, second } = await setup("a", "b");
      const firstView = await first.load();
      const secondView = await second.load();

      await second.save({ ...secondView, workspaces: [secondView.workspaces[0]!, workspace("b", "edited elsewhere")] });
      await first.save({ ...firstView, workspaces: [workspace("a", "edited here"), firstView.workspaces[1]!] });

      const saved = await new ConfigStore({ directory: tempDirectory }).load();

      expect(saved.workspaces.map((item) => item.items[0]?.command)).toEqual(["edited here", "edited elsewhere"]);
    });

    it("still deletes a workspace this instance removed", async () => {
      const { first, second } = await setup("a", "b");
      const firstView = await first.load();
      const secondView = await second.load();

      await second.save({ ...secondView, workspaces: [...secondView.workspaces, workspace("c")] });
      await first.save({ ...firstView, workspaces: [firstView.workspaces[0]!] });

      const saved = await new ConfigStore({ directory: tempDirectory }).load();

      expect(saved.workspaces.map((item) => item.id)).toEqual(["a", "c"]);
    });

    it("saves exactly what it was given when nothing changed meanwhile", async () => {
      const { first } = await setup("a");
      const view = await first.load();

      await first.save({ ...view, workspaces: [workspace("a", "npm start"), workspace("b")] });

      const saved = await new ConfigStore({ directory: tempDirectory }).load();

      expect(saved.workspaces.map((item) => item.id)).toEqual(["a", "b"]);
    });
  });
});
