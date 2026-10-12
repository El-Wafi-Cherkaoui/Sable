import path from "node:path";
import { createSettingsStore, settingsFile, type SettingsStore } from "../settings/settings-store.js";
import { createSoundPlayer, type SoundPlayer } from "./player.js";
import type { Cue } from "./sounds.js";

// What the screens use: play a cue, and read or change the saved preference.
export type SoundControl = {
  play(cue: Cue): void;
  isEnabled(): boolean;
  setEnabled(enabled: boolean): Promise<void>;
  // Stops the audio process; call when Sable exits.
  close(): void;
};

export function createSoundControl(player: SoundPlayer, store: SettingsStore): SoundControl {
  return {
    play: (cue) => player.play(cue),
    isEnabled: () => player.isEnabled(),
    close: () => player.close(),
    async setEnabled(enabled) {
      player.setEnabled(enabled);

      try {
        await store.update({ sound: enabled });
      } catch {
        // The choice still applies for this session; it just isn't remembered.
      }
    },
  };
}

// Sound is on unless the saved preference says otherwise.
export async function loadSoundControl(configDirectory: string): Promise<SoundControl> {
  const store = createSettingsStore(settingsFile(configDirectory));
  const settings = await store.load();
  const player = createSoundPlayer({ enabled: settings.sound, directory: path.join(configDirectory, "sounds") });

  return createSoundControl(player, store);
}
