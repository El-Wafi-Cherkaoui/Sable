import { describe, expect, it, vi } from "vitest";
import { claimFullSplash, localDay } from "./launch-splash.js";
import type { SettingsStore } from "./settings-store.js";

function createStore(lastSplashDay?: string): SettingsStore {
  return {
    load: vi.fn(async () => ({ sound: true, ...(lastSplashDay === undefined ? {} : { lastSplashDay }) })),
    save: vi.fn(async () => {}),
    update: vi.fn(async () => {}),
  };
}

describe("claimFullSplash", () => {
  const morning = new Date(2026, 9, 12, 9, 0);

  it("shows the full logo on the first launch of a day and remembers it", async () => {
    const store = createStore("2026-10-11");

    expect(await claimFullSplash(store, morning)).toBe(true);
    expect(store.update).toHaveBeenCalledWith({ lastSplashDay: "2026-10-12" });
  });

  it("shows the short logo for later launches the same day", async () => {
    const store = createStore("2026-10-12");

    expect(await claimFullSplash(store, new Date(2026, 9, 12, 18, 0))).toBe(false);
    expect(store.update).not.toHaveBeenCalled();
  });

  it("shows the full logo when nothing is saved or saving fails", async () => {
    expect(await claimFullSplash(createStore(), morning)).toBe(true);

    const broken = createStore();

    vi.mocked(broken.update).mockRejectedValue(new Error("read-only"));
    expect(await claimFullSplash(broken, morning)).toBe(true);
  });

  it("formats the local day with padding", () => {
    expect(localDay(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});
