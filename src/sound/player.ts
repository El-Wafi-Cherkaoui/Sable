import { bellbird, soundAllowed, type Bellbird, type BellbirdOptions } from "bellbird";
import { bellbirdCueNames, defineSableCues, type Cue } from "./sounds.js";

export type SoundPlayer = {
  play(cue: Cue): void;
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;
  // Stops the audio process; call when Sable exits.
  close(): void;
};

export type SoundPlayerOptions = {
  enabled: boolean;
  // Folder where bellbird keeps cue files, if it has to play from files.
  directory: string;
  // Whether the environment allows sound (BELLBIRD=0 and CI say no); read from the environment by default.
  allowed?: boolean;
  create?: (options: BellbirdOptions) => Bellbird;
};

// The sounds themselves come from bellbird. Sable only keeps the user's setting, and BELLBIRD=0 or CI
// still silence it. Every failure is silent; sound is never worth disturbing the terminal.
export function createSoundPlayer(options: SoundPlayerOptions): SoundPlayer {
  const allowed = options.allowed ?? soundAllowed();
  const sound = (options.create ?? bellbird)({ enabled: options.enabled && allowed, directory: options.directory, appName: "sable" });
  let enabled = options.enabled;

  defineSableCues(sound);

  return {
    isEnabled: () => enabled,
    setEnabled(next) {
      enabled = next;
      sound.setEnabled(next && allowed);
    },
    close: () => sound.close(),
    play(cue) {
      try {
        sound.play(bellbirdCueNames[cue]);
      } catch {
        // Safety net only: sounds.test.ts checks every cue name against bellbird, so a wrong name fails in CI.
      }
    },
  };
}
