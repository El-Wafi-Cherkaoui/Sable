import type { Cue } from "./sounds.js";

// Where cues actually come out: either a long-lived audio stream or one
// player process per cue.
export type SoundOutput = {
  play(cue: Cue): void;
  // Cuts everything that is playing.
  stopAll(): void;
  // The cues that are playing right now.
  playing(): Cue[];
  // True once this output can't work here, so the player should use another.
  failed(): boolean;
  close(): void;
};
