import { bellbird } from "bellbird";
import { describe, expect, it } from "vitest";
import { bellbirdCueNames, defineSableCues, type Cue } from "./sounds.js";

describe("bellbirdCueNames", () => {
  it("only names cues that the real bellbird has, once Sable's own are defined", () => {
    // Disabled, so no audio process starts. The player catches a wrong name at run time and goes quiet; this is what notices it.
    const sound = bellbird({ enabled: false });

    defineSableCues(sound);

    const known = sound.cues();

    for (const cue of Object.keys(bellbirdCueNames) as Cue[]) {
      expect(known, `Sable's "${cue}" cue plays "${bellbirdCueNames[cue]}"`).toContain(bellbirdCueNames[cue]);
    }
  });
});
