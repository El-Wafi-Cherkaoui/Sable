import { describe, expect, it, vi } from "vitest";
import { createPersistLogsToggle, createTipsToggle, createWelcomeScreenToggle } from "./settings-control.js";
import type { SettingsStore } from "./settings-store.js";

function createStore(update: SettingsStore["update"] = vi.fn(async () => {})): SettingsStore {
  return { load: vi.fn(), save: vi.fn(), update };
}

describe("createWelcomeScreenToggle", () => {
  it("applies the choice and saves it", async () => {
    const store = createStore();
    const toggle = createWelcomeScreenToggle(store, true);

    await toggle.setEnabled(false);

    expect(toggle.isEnabled()).toBe(false);
    expect(store.update).toHaveBeenCalledWith({ welcomeScreen: false });
  });

  it("still applies the choice when saving fails", async () => {
    const toggle = createWelcomeScreenToggle(createStore(vi.fn(async () => { throw new Error("read-only"); })), true);

    await expect(toggle.setEnabled(false)).resolves.toBeUndefined();
    expect(toggle.isEnabled()).toBe(false);
  });
});

describe("createPersistLogsToggle", () => {
  it("applies the choice and saves it under its own name", async () => {
    const store = createStore();
    const toggle = createPersistLogsToggle(store, false);

    await toggle.setEnabled(true);

    expect(toggle.isEnabled()).toBe(true);
    expect(store.update).toHaveBeenCalledWith({ persistLogs: true });
  });
});

describe("createTipsToggle", () => {
  it("applies the choice and saves it under its own name", async () => {
    const store = createStore();
    const toggle = createTipsToggle(store, true);

    await toggle.setEnabled(false);

    expect(toggle.isEnabled()).toBe(false);
    expect(store.update).toHaveBeenCalledWith({ tips: false });
  });
});
