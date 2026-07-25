import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ConfigParseError,
  ConfigStore,
  ConfigValidationError,
  defaultConfig,
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
});
