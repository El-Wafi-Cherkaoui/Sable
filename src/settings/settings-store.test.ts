import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createSettingsStore, settingsFile } from "./settings-store.js";

function tempFile(): string {
  return settingsFile(path.join(mkdtempSync(path.join(os.tmpdir(), "sable-settings-")), "nested"));
}

describe("settings store", () => {
  it("defaults to everything on when nothing is saved", async () => {
    expect(await createSettingsStore(tempFile()).load()).toEqual({ sound: true, welcomeScreen: true });
  });

  it("remembers sound turned off", async () => {
    const store = createSettingsStore(tempFile());

    await store.save({ sound: false, welcomeScreen: true });

    expect(await store.load()).toEqual({ sound: false, welcomeScreen: true });
  });

  it("falls back to the defaults for a corrupt or odd file", async () => {
    const file = tempFile();
    const store = createSettingsStore(file);

    await store.save({ sound: false, welcomeScreen: false });
    writeFileSync(file, "{ not json");
    expect(await store.load()).toEqual({ sound: true, welcomeScreen: true });

    writeFileSync(file, JSON.stringify({ sound: "no", welcomeScreen: 3 }));
    expect(await store.load()).toEqual({ sound: true, welcomeScreen: true });
  });

  it("keeps other settings when one changes", async () => {
    const store = createSettingsStore(tempFile());

    await store.update({ welcomeScreen: false });
    await store.update({ sound: false });

    expect(await store.load()).toEqual({ sound: false, welcomeScreen: false });
  });

  it("ignores settings from older versions", async () => {
    const file = tempFile();
    const store = createSettingsStore(file);

    await store.save({ sound: true, welcomeScreen: true });
    writeFileSync(file, JSON.stringify({ sound: false, lastSplashDay: "2026-10-12" }));

    expect(await store.load()).toEqual({ sound: false, welcomeScreen: true });
  });
});
