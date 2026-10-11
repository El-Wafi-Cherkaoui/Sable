import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isNewerVersion,
  isUpdateCheckEnabled,
  startUpdateCheck,
  updateCacheFile,
  updateInstallCommand,
} from "./update-check.js";

let directory: string;
let cacheFile: string;
const day = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "sable-update-"));
  cacheFile = updateCacheFile(directory);
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("isNewerVersion", () => {
  it("compares release versions numerically", () => {
    expect(isNewerVersion("0.3.0", "0.2.3")).toBe(true);
    expect(isNewerVersion("0.10.0", "0.9.9")).toBe(true);
    expect(isNewerVersion("1.0.0", "0.99.99")).toBe(true);
    expect(isNewerVersion("0.2.3", "0.2.3")).toBe(false);
    expect(isNewerVersion("0.2.2", "0.2.3")).toBe(false);
  });

  it("never offers pre-releases or unreadable versions", () => {
    expect(isNewerVersion("0.4.0-beta.1", "0.3.0")).toBe(false);
    expect(isNewerVersion("latest", "0.3.0")).toBe(false);
    expect(isNewerVersion("0.3.0", "0.3.0-rc.1")).toBe(false);
  });
});

describe("isUpdateCheckEnabled", () => {
  it("runs only in interactive terminals without an opt-out", () => {
    expect(isUpdateCheckEnabled({}, true)).toBe(true);
    expect(isUpdateCheckEnabled({}, false)).toBe(false);
    expect(isUpdateCheckEnabled({ NO_UPDATE_NOTIFIER: "1" }, true)).toBe(false);
    expect(isUpdateCheckEnabled({ SABLE_NO_UPDATE_CHECK: "1" }, true)).toBe(false);
    expect(isUpdateCheckEnabled({ CI: "true" }, true)).toBe(false);
    expect(isUpdateCheckEnabled({ CI: "false" }, true)).toBe(true);
  });
});

describe("startUpdateCheck", () => {
  it("fetches the latest version, reports it when newer, and caches it", async () => {
    const fetchLatest = vi.fn(async () => "0.4.0");
    const check = startUpdateCheck({ currentVersion: "0.3.0", cacheFile, env: {}, isInteractive: true, now: () => 1_000, fetchLatest });

    await check.done;

    expect(check.newerVersion()).toBe("0.4.0");
    expect(JSON.parse(await readFile(cacheFile, "utf8"))).toEqual({ checkedAt: 1_000, latest: "0.4.0" });
  });

  it("uses a fresh cache without asking npm, and shows it immediately", async () => {
    await writeFile(cacheFile, JSON.stringify({ checkedAt: 1_000, latest: "0.4.0" }));
    const fetchLatest = vi.fn(async () => "9.9.9");
    const check = startUpdateCheck({ currentVersion: "0.3.0", cacheFile, env: {}, isInteractive: true, now: () => 1_000 + day - 1, fetchLatest });

    await check.done;

    expect(fetchLatest).not.toHaveBeenCalled();
    expect(check.newerVersion()).toBe("0.4.0");
  });

  it("asks npm again once the cache is a day old", async () => {
    await writeFile(cacheFile, JSON.stringify({ checkedAt: 1_000, latest: "0.4.0" }));
    const fetchLatest = vi.fn(async () => "0.5.0");
    const check = startUpdateCheck({ currentVersion: "0.3.0", cacheFile, env: {}, isInteractive: true, now: () => 1_000 + day, fetchLatest });

    await check.done;

    expect(fetchLatest).toHaveBeenCalledOnce();
    expect(check.newerVersion()).toBe("0.5.0");
  });

  it("stays silent when offline, keeping any cached answer", async () => {
    const offline = startUpdateCheck({
      currentVersion: "0.3.0", cacheFile, env: {}, isInteractive: true, fetchLatest: async () => { throw new Error("ENOTFOUND"); },
    });

    await expect(offline.done).resolves.toBeUndefined();
    expect(offline.newerVersion()).toBeUndefined();

    await writeFile(cacheFile, JSON.stringify({ checkedAt: 0, latest: "0.4.0" }));
    const stale = startUpdateCheck({
      currentVersion: "0.3.0", cacheFile, env: {}, isInteractive: true, now: () => day * 2, fetchLatest: async () => { throw new Error("ENOTFOUND"); },
    });

    await stale.done;
    expect(stale.newerVersion()).toBe("0.4.0");
  });

  it("does nothing when you are already up to date or checks are off", async () => {
    const current = startUpdateCheck({ currentVersion: "0.4.0", cacheFile, env: {}, isInteractive: true, fetchLatest: async () => "0.4.0" });
    const fetchLatest = vi.fn(async () => "0.5.0");
    const disabled = startUpdateCheck({ currentVersion: "0.3.0", cacheFile, env: { SABLE_NO_UPDATE_CHECK: "1" }, isInteractive: true, fetchLatest });

    await Promise.all([current.done, disabled.done]);

    expect(current.newerVersion()).toBeUndefined();
    expect(disabled.newerVersion()).toBeUndefined();
    expect(fetchLatest).not.toHaveBeenCalled();
  });

  it("can be cancelled so quitting never waits on the network", async () => {
    const fetchLatest = (signal: AbortSignal) => new Promise<string>((_, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")));
    });
    const check = startUpdateCheck({ currentVersion: "0.3.0", cacheFile, env: {}, isInteractive: true, fetchLatest });

    check.cancel();

    await expect(check.done).resolves.toBeUndefined();
  });
});

describe("dismissing a version", () => {
  it("stops offering that version, but offers a newer one", async () => {
    const first = startUpdateCheck({ currentVersion: "0.3.0", cacheFile, env: {}, isInteractive: true, now: () => 1_000, fetchLatest: async () => "0.4.0" });

    await first.done;
    await first.dismiss("0.4.0");

    expect(first.newerVersion()).toBeUndefined();
    expect(JSON.parse(await readFile(cacheFile, "utf8"))).toEqual({ checkedAt: 1_000, latest: "0.4.0", dismissed: "0.4.0" });

    const nextLaunch = startUpdateCheck({ currentVersion: "0.3.0", cacheFile, env: {}, isInteractive: true, now: () => 2_000, fetchLatest: async () => "9.9.9" });

    await nextLaunch.done;
    expect(nextLaunch.newerVersion()).toBeUndefined();

    const dayLater = startUpdateCheck({ currentVersion: "0.3.0", cacheFile, env: {}, isInteractive: true, now: () => 1_000 + day, fetchLatest: async () => "0.5.0" });

    await dayLater.done;
    expect(dayLater.newerVersion()).toBe("0.5.0");
  });
});

describe("updateInstallCommand", () => {
  it("installs the latest published package globally", () => {
    expect(updateInstallCommand()).toEqual({
      command: "npm",
      args: ["install", "-g", "sable-workspaces@latest"],
      display: "npm install -g sable-workspaces@latest",
    });
  });
});
