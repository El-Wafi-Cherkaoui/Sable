import { describe, expect, it, vi } from "vitest";
import { createSoundControl } from "./sound-control.js";

describe("createSoundControl", () => {
  it("applies the choice and saves it", async () => {
    const player = { play: vi.fn(), setEnabled: vi.fn(), isEnabled: vi.fn(() => true) };
    const store = { load: vi.fn(), save: vi.fn(), update: vi.fn(async () => {}) };
    const control = createSoundControl(player, store);

    await control.setEnabled(false);
    control.play("open");

    expect(player.setEnabled).toHaveBeenCalledWith(false);
    expect(store.update).toHaveBeenCalledWith({ sound: false });
    expect(player.play).toHaveBeenCalledWith("open");
  });

  it("still applies the choice when saving fails", async () => {
    const player = { play: vi.fn(), setEnabled: vi.fn(), isEnabled: vi.fn(() => true) };
    const store = { load: vi.fn(), save: vi.fn(), update: vi.fn(async () => { throw new Error("read-only"); }) };

    await expect(createSoundControl(player, store).setEnabled(false)).resolves.toBeUndefined();
    expect(player.setEnabled).toHaveBeenCalledWith(false);
  });
});
