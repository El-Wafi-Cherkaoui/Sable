import { describe, expect, it, vi } from "vitest";
import type { KeyInput } from "../input/terminal-key-input.js";
import type { SettingsControl } from "../settings/settings-control.js";
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

function createSettings(initial = { sound: true, welcomeScreen: true }) {
  const state = { ...initial };
  const settings: SettingsControl = {
    sound: {
      play: vi.fn(),
      close: vi.fn(),
      isEnabled: () => state.sound,
      setEnabled: vi.fn(async (next: boolean) => {
        state.sound = next;
      }),
    },
    welcomeScreen: {
      isEnabled: () => state.welcomeScreen,
      setEnabled: vi.fn(async (next: boolean) => {
        state.welcomeScreen = next;
      }),
    },
  };

  return settings;
}

const open = (settings: SettingsControl, keys: Awaited<ReturnType<KeyInput["readKey"]>>[], write = vi.fn()) =>
  runSettingsDialog({ settings, keyInput: createKeyInput(keys), screen: { clear: vi.fn(), write }, color: false });

describe("settings dialog", () => {
  it("lists both settings with a marker on the selected one", () => {
    const items = [
      { label: "Sound", enabled: true, description: "sound text" },
      { label: "Welcome screen", enabled: false, description: "welcome text" },
    ];
    const first = renderSettingsDialog({ items, selected: 0 });
    const second = renderSettingsDialog({ items, selected: 1 });

    expect(first).toContain("> Sound            ● on");
    expect(first).toContain("  Welcome screen   ○ off");
    expect(first).toContain("sound text");
    expect(second).toContain("  Sound            ● on");
    expect(second).toContain("> Welcome screen   ○ off");
    expect(second).toContain("welcome text");
    expect(first).toContain("Settings");
  });

  it("keeps the box the same size whichever setting is selected", () => {
    const items = [
      { label: "Sound", enabled: true, description: "A fairly long description that has to wrap across more than one line in the box." },
      { label: "Welcome screen", enabled: false, description: "Short." },
    ];
    const shape = (selected: number, columns: number) => renderSettingsDialog({ items, selected, columns, rows: 20 })
      .split("\n")
      .filter((line) => /[╭│╰]/.test(line))
      .map((line) => [...line.replace(/\x1b\[[0-9;]*m/g, "")].length);

    for (const columns of [80, 40]) {
      expect(shape(0, columns)).toEqual(shape(1, columns));
    }
  });

  it("toggles sound with Space and closes with Esc", async () => {
    const settings = createSettings();
    const write = vi.fn();

    const result = await open(settings, [{ sequence: " ", name: "space" }, { name: "escape" }], write);

    expect(result).toBe("close");
    expect(settings.sound.setEnabled).toHaveBeenCalledWith(false);
    expect(settings.welcomeScreen.setEnabled).not.toHaveBeenCalled();
    expect(write.mock.calls.at(-1)![0]).toContain("Sound            ○ off");
  });

  it("moves to the welcome screen with ↓ and toggles only that", async () => {
    const settings = createSettings();

    await open(settings, [{ name: "down" }, { name: "return" }, { sequence: "," }]);

    expect(settings.welcomeScreen.setEnabled).toHaveBeenCalledWith(false);
    expect(settings.sound.setEnabled).not.toHaveBeenCalled();
  });

  it("wraps the selection around the list", async () => {
    const settings = createSettings();

    await open(settings, [{ name: "up" }, { name: "return" }, { name: "down" }, { name: "return" }, { name: "escape" }]);

    expect(settings.welcomeScreen.setEnabled).toHaveBeenCalledWith(false);
    expect(settings.sound.setEnabled).toHaveBeenCalledWith(false);
  });

  it("plays a cue when sound is turned back on, not when turned off", async () => {
    const settings = createSettings({ sound: false, welcomeScreen: true });

    await open(settings, [{ name: "return" }, { name: "return" }, { sequence: "," }]);

    expect(settings.sound.setEnabled).toHaveBeenNthCalledWith(1, true);
    expect(settings.sound.setEnabled).toHaveBeenNthCalledWith(2, false);
    expect(settings.sound.play).toHaveBeenCalledTimes(1);
  });

  it("exits on Ctrl+C", async () => {
    expect(await open(createSettings(), [{ ctrl: true, name: "c" }])).toBe("exit");
  });
});
