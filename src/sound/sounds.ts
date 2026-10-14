import type { Bellbird } from "bellbird";

export type Cue = "move" | "open" | "back" | "started" | "stopped" | "attention";

// Sable's cue names, and the bellbird cue each one plays. Only `move` is Sable's own.
export const bellbirdCueNames: Record<Cue, string> = {
  move: "move",
  open: "open",
  back: "close",
  started: "start",
  stopped: "stop",
  attention: "attention",
};

// The quiet tick for moving through a list: bellbird skips it while anything else plays.
export function defineSableCues(sound: Bellbird): void {
  sound.define("move", { notes: [{ note: "E5", ms: 40 }], volume: 0.1, kind: "tick" });
}
