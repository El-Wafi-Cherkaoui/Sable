import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
      version: 1 as const,
      workspaces: [
        {
          id: "workspace-1",
          name: "ecommerce",
          projectDirectory: "/projects/ecommerce",
          commands: [],
          services: [
            {
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
      version: 1,
      workspaces: [
        {
          id: "workspace-1",
          name: "ecommerce",
          projectDirectory: path.resolve("/projects/ecommerce/backend"),
          commands: [],
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
      version: 1,
      workspaces: [
        {
          id: "workspace-1",
          name: "empty",
          projectDirectory: process.cwd(),
          services: [],
          commands: [],
        },
      ],
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
      JSON.stringify({ version: 2, workspaces: [] }),
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
});
