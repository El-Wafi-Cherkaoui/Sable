import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createSettingsStore, settingsFile } from "./settings-store.js";

function tempFile(): string {
  return settingsFile(path.join(mkdtempSync(path.join(os.tmpdir(), "sable-settings-")), "nested"));
}

describe("settings store", () => {
  it("defaults to sound on when nothing is saved", async () => {
    expect(await createSettingsStore(tempFile()).load()).toEqual({ sound: true });
  });

  it("remembers sound turned off", async () => {
    const store = createSettingsStore(tempFile());

    await store.save({ sound: false });

    expect(await store.load()).toEqual({ sound: false });
  });

  it("falls back to the defaults for a corrupt or odd file", async () => {
    const file = tempFile();
    const store = createSettingsStore(file);

    await store.save({ sound: false });
    writeFileSync(file, "{ not json");
    expect(await store.load()).toEqual({ sound: true });

    writeFileSync(file, JSON.stringify({ sound: "no" }));
    expect(await store.load()).toEqual({ sound: true });
  });

  it("keeps other settings when one changes", async () => {
    const store = createSettingsStore(tempFile());

    await store.update({ lastSplashDay: "2026-10-12" });
    await store.update({ sound: false });

    expect(await store.load()).toEqual({ sound: false, lastSplashDay: "2026-10-12" });
  });
});
