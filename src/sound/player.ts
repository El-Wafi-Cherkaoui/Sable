import { createProcessOutput, type SoundSpawn } from "./process-output.js";
import type { SoundOutput } from "./sound-output.js";
import type { Cue } from "./sounds.js";
import { createStreamOutput, streamBackends, type StreamBackend, type StreamSpawn } from "./stream-output.js";

export type { SoundProcess, SoundSpawn } from "./process-output.js";
export type { StreamProcess, StreamSpawn } from "./stream-output.js";

export type SoundPlayer = {
  play(cue: Cue): void;
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;
  // Stops the audio process; call when Sable exits.
  close(): void;
};

export type SoundPlayerOptions = {
  enabled: boolean;
  // Folder where the generated cue files are kept (when playing from files).
  directory: string;
  platform?: NodeJS.Platform;
  spawn?: SoundSpawn;
  streamSpawn?: StreamSpawn;
  streamBackends?: StreamBackend[];
  now?: () => number;
};

const moveGapMs = 60;
const repeatGapMs = 100;

// Sable ships no audio files and no audio dependency: cues are synthesized in
// code. On Linux they are mixed into one audio stream that stays open, which
// gives every cue the same short delay. Elsewhere, or if no stream player
// works, each cue is written to a small WAV file and played by the OS player.
// Every failure is silent; sound is never worth disturbing the terminal.
export function createSoundPlayer(options: SoundPlayerOptions): SoundPlayer {
  const platform = options.platform ?? process.platform;
  const now = options.now ?? Date.now;
  const backends = options.streamBackends ?? streamBackends(platform);
  const stream = backends.length === 0
    ? undefined
    : createStreamOutput({ backends, spawn: options.streamSpawn, now });
  const files = createProcessOutput({ directory: options.directory, platform, spawn: options.spawn });
  const lastPlayed = new Map<Cue, number>();
  let lastAnyAt = Number.NEGATIVE_INFINITY;
  let enabled = options.enabled;

  const output = (): SoundOutput => (stream !== undefined && !stream.failed() ? stream : files);

  const start = () => {
    if (stream !== undefined) {
      stream.open();
    } else {
      files.prepare();
    }
  };

  if (enabled) {
    start();
  }

  return {
    isEnabled: () => enabled,
    setEnabled(next) {
      enabled = next;

      if (next) {
        start();
      } else {
        stream?.close();
        files.stopAll();
      }
    },
    close() {
      stream?.close();
      files.stopAll();
    },
    play(cue) {
      if (!enabled) {
        return;
      }

      const out = output();
      const at = now();
      const playing = out.playing();

      // A chime always finishes, and a tick never plays over another sound.
      if (cue !== "attention" && playing.includes("attention")) {
        return;
      }

      if (cue === "move" && (at - lastAnyAt < moveGapMs || playing.length > 0)) {
        return;
      }

      if (at - (lastPlayed.get(cue) ?? Number.NEGATIVE_INFINITY) < repeatGapMs) {
        return;
      }

      lastPlayed.set(cue, at);
      lastAnyAt = at;
      out.play(cue);
    },
  };
}
