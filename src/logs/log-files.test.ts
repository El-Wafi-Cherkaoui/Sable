import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ServiceLogEntry } from "../process/process-manager.js";
import { createLogFiles, safeSegment, type LogTarget } from "./log-files.js";

let directory: string;

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "sable-log-files-"));
});

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true });
});

const api: LogTarget = { workspace: "shop", name: "api", kind: "service" };
const build: LogTarget = { workspace: "shop", name: "build", kind: "command" };

function entry(line: string, stream: ServiceLogEntry["stream"] = "stdout", at = "2026-10-13T11:42:01.123Z"): ServiceLogEntry {
  return { stream, line, timestamp: new Date(at) };
}

function logFiles(options: { enabled?: () => boolean; maxBytes?: number } = {}) {
  return createLogFiles({ directory, isEnabled: options.enabled ?? (() => true), maxBytes: options.maxBytes, flushMs: 5 });
}

const read = (file: string) => fs.readFile(file, "utf8");

describe("createLogFiles", () => {
  it("writes each line with its time and stream to a file named after the workspace and item", async () => {
    const files = logFiles();

    files.append(api, entry("listening on 3000"));
    files.append(api, entry("Error: boom", "stderr", "2026-10-13T11:42:02.000Z"));
    files.append(api, entry("service started", "system"));
    await files.close();

    expect(files.pathFor(api)).toBe(path.join(directory, "shop", "api.log"));
    expect(await read(files.pathFor(api))).toBe([
      "2026-10-13T11:42:01.123Z [stdout] listening on 3000",
      "2026-10-13T11:42:02.000Z [stderr] Error: boom",
      "2026-10-13T11:42:01.123Z [system] service started",
      "",
    ].join("\n"));
  });

  it("keeps a command's log apart from a service with the same name", async () => {
    const files = logFiles();

    expect(files.pathFor({ workspace: "shop", name: "build", kind: "service" })).toBe(path.join(directory, "shop", "build.log"));
    expect(files.pathFor(build)).toBe(path.join(directory, "shop", "build.command.log"));
  });

  it("writes batched lines on its own after a moment, and keeps appending to the same file across runs", async () => {
    const first = logFiles();

    first.append(api, entry("one"));
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(await read(first.pathFor(api))).toContain("one");

    const second = logFiles();

    second.append(api, entry("two"));
    await second.close();

    expect((await read(second.pathFor(api))).trim().split("\n")).toHaveLength(2);
  });

  it("writes nothing while the setting is off, and starts when it is switched on", async () => {
    let enabled = false;
    const files = logFiles({ enabled: () => enabled });

    files.append(api, entry("before"));
    enabled = true;
    files.append(api, entry("after"));
    await files.close();

    expect(await read(files.pathFor(api))).toContain("after");
    expect(await read(files.pathFor(api))).not.toContain("before");

    enabled = false;

    const idle = logFiles({ enabled: () => false });

    idle.append(build, entry("never"));
    await idle.close();
    await expect(fs.access(idle.pathFor(build))).rejects.toThrow();
  });

  it("moves a full file aside, keeping one older copy, instead of growing without limit", async () => {
    const files = logFiles({ maxBytes: 300 });
    const lineOf = (index: number) => entry(`line ${String(index).padStart(3, "0")} ${"x".repeat(40)}`);

    for (let index = 0; index < 4; index += 1) {
      files.append(api, lineOf(index));
    }

    await files.flush();

    for (let index = 4; index < 12; index += 1) {
      files.append(api, lineOf(index));
      await files.flush();
    }

    await files.close();

    const current = await read(files.pathFor(api));
    const older = await read(`${files.pathFor(api)}.1`);

    expect(Buffer.byteLength(current)).toBeLessThanOrEqual(300);
    expect(current).toContain("line 011");
    expect(older).toContain("line ");
    await expect(fs.access(`${files.pathFor(api)}.2`)).rejects.toThrow();
  });

  it("makes names safe to use as file names on any system", () => {
    expect(safeSegment("my api")).toBe("my api");
    expect(safeSegment("a/b\\c:d*e?")).toBe("a_b_c_d_e_");
    expect(safeSegment("..")).toBe("_");
    expect(safeSegment("  trailing. ")).toBe("trailing");
    expect(safeSegment("con")).toBe("_con");
    expect(safeSegment("")).toBe("_");
    expect(safeSegment("x".repeat(200))).toHaveLength(80);
  });

  it("does not fail when the folder cannot be written", async () => {
    const blocked = path.join(directory, "blocked");

    await fs.writeFile(blocked, "a file, not a folder");

    const files = createLogFiles({ directory: blocked, isEnabled: () => true, flushMs: 1 });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      files.append(api, entry("lost"));
      await expect(files.flush()).resolves.toBeUndefined();
    }

    await expect(files.close()).resolves.toBeUndefined();
  });
});

describe("readEarlier", () => {
  async function previousRun(lines: string[]) {
    const earlier = logFiles();

    for (const line of lines) {
      earlier.append(api, entry(line));
    }

    await earlier.close();
  }

  it("returns the lines saved before this run first used the file, as entries", async () => {
    await previousRun(["old one", "old two", "old three"]);

    const files = logFiles();
    const lines = await files.readEarlier(api, 2);

    expect(lines.map((item) => item.line)).toEqual(["old two", "old three"]);
    expect(lines[0]).toEqual(entry("old two"));
  });

  it("leaves out what this run wrote, even when it asks late", async () => {
    await previousRun(["old"]);

    const files = logFiles();

    files.append(api, entry("new"));
    await files.flush();

    expect((await files.readEarlier(api, 10)).map((item) => item.line)).toEqual(["old"]);
  });

  it("gives nothing for a file that is not there, while saving is off, or after the file was rotated away", async () => {
    expect(await logFiles().readEarlier(api, 10)).toEqual([]);

    await previousRun(["old"]);

    expect(await logFiles({ enabled: () => false }).readEarlier(api, 10)).toEqual([]);

    const rotating = logFiles({ maxBytes: 100 });

    await rotating.readEarlier(api, 1);
    rotating.append(api, entry("z".repeat(150)));
    await rotating.flush();

    expect(await rotating.readEarlier(api, 10)).toEqual([]);
  });

  it("skips lines that are not in the log format", async () => {
    const file = path.join(directory, "shop", "api.log");

    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "garbage line\n2026-10-13T11:42:01.123Z [stderr] real\n");

    expect((await logFiles().readEarlier(api, 10)).map((item) => [item.stream, item.line])).toEqual([["stderr", "real"]]);
  });

  it("only reads the end of a very long file, dropping the half line it starts in", async () => {
    const file = path.join(directory, "shop", "api.log");
    const full = "2026-10-13T11:42:01.123Z [stdout] " + "y".repeat(100) + "\n";

    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, full.repeat(4000) + "2026-10-13T11:42:01.123Z [stdout] last\n");

    const lines = await logFiles().readEarlier(api, 100_000);

    expect(lines.at(-1)?.line).toBe("last");
    expect(lines.length).toBeLessThan(4001);
    expect(lines.every((item) => item.line === "last" || item.line === "y".repeat(100))).toBe(true);
  });
});
