import { describe, expect, it, vi } from "vitest";
import type { KeyInput } from "../input/terminal-key-input.js";
import type { SoundControl } from "../sound/sound-control.js";
import { renderSettingsDialog, runSettingsDialog } from "./settings-dialog.js";

function createKeyInput(keys: Awaited<ReturnType<KeyInput["readKey"]>>[]): KeyInput {
  return {
    readKey: vi.fn(async () => {
      const key = keys.shift();

      if (key === undefined) {
        throw new Error("No key queued.");
      }

      return key;
    }),
    close: vi.fn(),
  };
}

function createSound(enabled: boolean) {
  let on = enabled;
  const sound: SoundControl = {
    play: vi.fn(),
    isEnabled: () => on,
    setEnabled: vi.fn(async (next: boolean) => {
      on = next;
    }),
  };

  return sound;
}

describe("settings dialog", () => {
  it("shows the sound setting with a selection marker", () => {
    expect(renderSettingsDialog({ soundEnabled: true })).toContain("> Sound   ● on");
    expect(renderSettingsDialog({ soundEnabled: false })).toContain("> Sound   ○ off");
    expect(renderSettingsDialog({ soundEnabled: true })).toContain("Settings");
  });

  it("toggles sound with Space and closes with Esc", async () => {
    const sound = createSound(true);
    const write = vi.fn();

    const result = await runSettingsDialog({
      sound,
      keyInput: createKeyInput([{ sequence: " ", name: "space" }, { name: "escape" }]),
      screen: { clear: vi.fn(), write },
      color: false,
    });

    expect(result).toBe("close");
    expect(sound.setEnabled).toHaveBeenCalledWith(false);
    expect(write.mock.calls.at(-1)![0]).toContain("○ off");
  });

  it("plays a cue when sound is turned back on, not when turned off", async () => {
    const sound = createSound(false);

    await runSettingsDialog({
      sound,
      keyInput: createKeyInput([{ name: "return" }, { name: "return" }, { sequence: "," }]),
      screen: { clear: vi.fn(), write: vi.fn() },
      color: false,
    });

    expect(sound.setEnabled).toHaveBeenNthCalledWith(1, true);
    expect(sound.setEnabled).toHaveBeenNthCalledWith(2, false);
    expect(sound.play).toHaveBeenCalledTimes(1);
  });

  it("exits on Ctrl+C", async () => {
    const result = await runSettingsDialog({
      sound: createSound(true),
      keyInput: createKeyInput([{ ctrl: true, name: "c" }]),
      screen: { clear: vi.fn(), write: vi.fn() },
      color: false,
    });

    expect(result).toBe("exit");
  });
});
