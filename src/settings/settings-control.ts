import path from "node:path";
import { createSoundPlayer } from "../sound/player.js";
import { createSoundControl, type SoundControl } from "../sound/sound-control.js";
import { createSettingsStore, settingsFile, type SettingsStore } from "./settings-store.js";

export type SettingToggle = {
  isEnabled(): boolean;
  setEnabled(enabled: boolean): Promise<void>;
};

// What the Settings popup changes: each setting applies right away and is saved.
export type SettingsControl = {
  sound: SoundControl;
  welcomeScreen: SettingToggle;
};

export function createWelcomeScreenToggle(store: SettingsStore, enabled: boolean): SettingToggle {
  let current = enabled;

  return {
    isEnabled: () => current,
    async setEnabled(next) {
      current = next;

      try {
        await store.update({ welcomeScreen: next });
      } catch {
        // The choice still applies this session; it just isn't remembered.
      }
    },
  };
}

// Everything is on unless the saved settings say otherwise.
export async function loadSettingsControl(configDirectory: string): Promise<SettingsControl> {
  const store = createSettingsStore(settingsFile(configDirectory));
  const settings = await store.load();
  const player = createSoundPlayer({ enabled: settings.sound, directory: path.join(configDirectory, "sounds") });

  return {
    sound: createSoundControl(player, store),
    welcomeScreen: createWelcomeScreenToggle(store, settings.welcomeScreen),
  };
}
