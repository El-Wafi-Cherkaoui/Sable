import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createSettingsStore, settingsFile } from "./settings-store.js";

function tempFile(): string {
  return settingsFile(path.join(mkdtempSync(path.join(os.tmpdir(), "sable-settings-")), "nested"));
}

describe("settings store", () => {
  it("defaults to sound and the welcome screen on and saved logs off", async () => {
    expect(await createSettingsStore(tempFile()).load()).toEqual({ sound: true, welcomeScreen: true, persistLogs: false });
  });

  it("remembers sound turned off", async () => {
    const store = createSettingsStore(tempFile());

    await store.save({ sound: false, welcomeScreen: true, persistLogs: false });

    expect(await store.load()).toEqual({ sound: false, welcomeScreen: true, persistLogs: false });
  });

  it("falls back to the defaults for a corrupt or odd file", async () => {
    const file = tempFile();
    const store = createSettingsStore(file);

    await store.save({ sound: false, welcomeScreen: false, persistLogs: true });
    writeFileSync(file, "{ not json");
    expect(await store.load()).toEqual({ sound: true, welcomeScreen: true, persistLogs: false });

    writeFileSync(file, JSON.stringify({ sound: "no", welcomeScreen: 3, persistLogs: "yes" }));
    expect(await store.load()).toEqual({ sound: true, welcomeScreen: true, persistLogs: false });
  });

  it("keeps other settings when one changes", async () => {
    const store = createSettingsStore(tempFile());

    await store.update({ welcomeScreen: false });
    await store.update({ sound: false });

    expect(await store.load()).toEqual({ sound: false, welcomeScreen: false, persistLogs: false });
  });

  it("ignores settings from older versions", async () => {
    const file = tempFile();
    const store = createSettingsStore(file);

    await store.save({ sound: true, welcomeScreen: true, persistLogs: false });
    writeFileSync(file, JSON.stringify({ sound: false, lastSplashDay: "2026-10-12" }));

    expect(await store.load()).toEqual({ sound: false, welcomeScreen: true, persistLogs: false });
  });

  it("remembers that saving logs was turned on", async () => {
    const store = createSettingsStore(tempFile());

    await store.update({ persistLogs: true });

    expect(await store.load()).toEqual({ sound: true, welcomeScreen: true, persistLogs: true });
  });
});
