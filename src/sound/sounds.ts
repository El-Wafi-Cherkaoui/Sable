import { renderSamples, renderTones, type Note } from "./tones.js";

export type Cue = "move" | "open" | "back" | "started" | "stopped" | "attention";

// Notes come from one major pentatonic scale (C, D, E, G, A; only some are used), so any two
// cues played back to back still sound pleasant together.
const notes = { c5: 523.25, e5: 659.25, g5: 783.99, a5: 880 };

type CueDefinition = { notes: Note[]; volume: number };

export const cues: Record<Cue, CueDefinition> = {
  move: { notes: [{ frequency: notes.e5, startMs: 0, durationMs: 40 }], volume: 0.1 },
  open: {
    notes: [
      { frequency: notes.c5, startMs: 0, durationMs: 140 },
      { frequency: notes.g5, startMs: 70, durationMs: 200 },
    ],
    volume: 0.22,
  },
  back: {
    notes: [
      { frequency: notes.g5, startMs: 0, durationMs: 140 },
      { frequency: notes.c5, startMs: 70, durationMs: 200 },
    ],
    volume: 0.2,
  },
  started: {
    notes: [
      { frequency: notes.c5, startMs: 0, durationMs: 150 },
      { frequency: notes.e5, startMs: 80, durationMs: 220 },
    ],
    volume: 0.22,
  },
  stopped: {
    notes: [
      { frequency: notes.e5, startMs: 0, durationMs: 150 },
      { frequency: notes.c5, startMs: 80, durationMs: 220 },
    ],
    volume: 0.2,
  },
  attention: {
    notes: [
      { frequency: notes.e5, startMs: 0, durationMs: 320 },
      { frequency: notes.a5, startMs: 0, durationMs: 320 },
      { frequency: notes.c5, startMs: 220, durationMs: 520 },
      { frequency: notes.g5, startMs: 220, durationMs: 520 },
    ],
    volume: 0.26,
  },
};

export function renderCue(cue: Cue): Buffer {
  return renderTones(cues[cue].notes, cues[cue].volume);
}

export function renderCueSamples(cue: Cue): Int16Array {
  return renderSamples(cues[cue].notes, cues[cue].volume);
}
