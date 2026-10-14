import { describe, expect, it, vi } from "vitest";
import type { Bellbird } from "bellbird";
import { createSoundPlayer } from "./player.js";

function fakeBellbird() {
  const sound = {
    play: vi.fn(),
    playAndWait: vi.fn(async () => undefined),
    define: vi.fn(),
    cues: vi.fn(() => []),
    ready: vi.fn(async () => undefined),
    output: vi.fn(() => "none" as const),
    setEnabled: vi.fn(),
    isEnabled: vi.fn(() => true),
    close: vi.fn(),
  } satisfies Bellbird;
  const create = vi.fn(() => sound);

  return { sound, create };
}

describe("createSoundPlayer", () => {
  it("starts bellbird with the saved setting and Sable's folder, and defines the move tick", () => {
    const { sound, create } = fakeBellbird();

    createSoundPlayer({ enabled: true, directory: "/cfg/sounds", allowed: true, create });

    expect(create).toHaveBeenCalledWith({ enabled: true, directory: "/cfg/sounds", appName: "sable" });
    expect(sound.define).toHaveBeenCalledWith("move", expect.objectContaining({ kind: "tick" }));
  });

  it("plays each cue under its bellbird name", () => {
    const { sound, create } = fakeBellbird();
    const player = createSoundPlayer({ enabled: true, directory: "/d", allowed: true, create });

    for (const cue of ["move", "open", "back", "started", "stopped", "attention"] as const) {
      player.play(cue);
    }

    expect(sound.play.mock.calls.map(([name]) => name)).toEqual(["move", "open", "close", "start", "stop", "attention"]);
  });

  it("keeps the user's choice but stays silent when the environment says no sound", () => {
    const { sound, create } = fakeBellbird();
    const player = createSoundPlayer({ enabled: true, directory: "/d", allowed: false, create });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
    expect(player.isEnabled()).toBe(true);

    player.setEnabled(true);

    expect(sound.setEnabled).toHaveBeenLastCalledWith(false);
  });

  it("turns bellbird on and off with the setting", () => {
    const { sound, create } = fakeBellbird();
    const player = createSoundPlayer({ enabled: false, directory: "/d", allowed: true, create });

    expect(player.isEnabled()).toBe(false);

    player.setEnabled(true);

    expect(player.isEnabled()).toBe(true);
    expect(sound.setEnabled).toHaveBeenLastCalledWith(true);
  });

  it("never throws when bellbird does", () => {
    const { sound, create } = fakeBellbird();
    const player = createSoundPlayer({ enabled: true, directory: "/d", allowed: true, create });

    sound.play.mockImplementation(() => {
      throw new Error("boom");
    });

    expect(() => player.play("open")).not.toThrow();
  });

  it("closes bellbird", () => {
    const { sound, create } = fakeBellbird();

    createSoundPlayer({ enabled: true, directory: "/d", allowed: true, create }).close();

    expect(sound.close).toHaveBeenCalledOnce();
  });
});
