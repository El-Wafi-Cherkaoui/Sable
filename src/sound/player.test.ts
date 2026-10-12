import { mkdtempSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createSoundPlayer, type SoundProcess, type SoundSpawn } from "./player.js";
import type { StreamBackend } from "./stream-output.js";

type Handlers = { error?: (error: NodeJS.ErrnoException) => void; exit?: (code: number | null) => void };

function fakeSpawn(behavior: (command: string, handlers: Handlers) => void = () => {}) {
  const calls: Array<{ command: string; args: string[] }> = [];
  const children: SoundProcess[] = [];
  const spawn: SoundSpawn = (command, args) => {
    const handlers: Handlers = {};
    const child: SoundProcess = {
      on(event: "error" | "exit", listener: never) {
        handlers[event] = listener;
        return child;
      },
      unref: vi.fn(),
      kill: vi.fn(() => {
        queueMicrotask(() => handlers.exit?.(null));
      }),
    };

    calls.push({ command, args });
    children.push(child);
    queueMicrotask(() => behavior(command, handlers));

    return child;
  };

  return { spawn, calls, children };
}

function setup(options: { platform?: NodeJS.Platform; enabled?: boolean; spawn: SoundSpawn; now?: () => number; streamBackends?: StreamBackend[] }) {
  const directory = path.join(mkdtempSync(path.join(os.tmpdir(), "sable-sound-")), "sounds");

  return { directory, player: createSoundPlayer({ enabled: options.enabled ?? true, directory, platform: options.platform ?? "linux", spawn: options.spawn, now: options.now, streamBackends: options.streamBackends ?? [] }) };
}

describe("createSoundPlayer", () => {
  it("writes the cue file and plays it with the platform player", () => {
    const { spawn, calls } = fakeSpawn();
    const { player, directory } = setup({ platform: "darwin", spawn });

    player.play("open");

    expect(calls).toEqual([{ command: "afplay", args: [path.join(directory, "open.wav")] }]);
    expect(existsSync(path.join(directory, "open.wav"))).toBe(true);
  });

  it("uses PowerShell's sound player on Windows", () => {
    const { spawn, calls } = fakeSpawn();
    const { player } = setup({ platform: "win32", spawn });

    player.play("open");

    expect(calls[0]!.command).toBe("powershell");
    expect(calls[0]!.args.at(-1)).toContain("Media.SoundPlayer");
  });

  it("plays nothing while disabled, and again once enabled", () => {
    const { spawn, calls } = fakeSpawn();
    const { player } = setup({ enabled: false, spawn });

    player.play("open");
    expect(calls).toHaveLength(0);

    player.setEnabled(true);
    player.play("open");
    expect(calls).toHaveLength(1);
  });

  it("falls back to the next Linux player when one is missing", async () => {
    let time = 0;
    const { spawn, calls } = fakeSpawn((command, handlers) => {
      if (command === "paplay") {
        handlers.error?.(Object.assign(new Error("not found"), { code: "ENOENT" }));
      }
    });
    const { player } = setup({ spawn, now: () => time });

    player.play("open");
    await Promise.resolve();
    await Promise.resolve();
    time += 1_000;
    player.play("open");

    expect(calls.map((call) => call.command)).toEqual(["paplay", "pw-play"]);
  });

  it("goes quiet for good when no player exists", async () => {
    let time = 0;
    const { spawn, calls } = fakeSpawn((_command, handlers) => {
      handlers.error?.(Object.assign(new Error("not found"), { code: "ENOENT" }));
    });
    const { player } = setup({ spawn, now: () => time });

    for (let index = 0; index < 6; index += 1) {
      player.play("open");
      await Promise.resolve();
      await Promise.resolve();
      time += 1_000;
    }

    expect(calls.map((call) => call.command)).toEqual(["paplay", "pw-play", "aplay"]);
  });

  it("stops trying after repeated failures", async () => {
    let time = 0;
    const { spawn, calls } = fakeSpawn((_command, handlers) => handlers.exit?.(1));
    const { player } = setup({ spawn, now: () => time });

    for (let index = 0; index < 6; index += 1) {
      player.play("open");
      await Promise.resolve();
      await Promise.resolve();
      time += 1_000;
    }

    expect(calls).toHaveLength(3);
  });

  it("drops move ticks that come too fast, but not slower ones", async () => {
    let time = 1_000;
    const { spawn, calls } = fakeSpawn((_command, handlers) => handlers.exit?.(0));
    const { player } = setup({ spawn, now: () => time });

    player.play("move");
    await Promise.resolve();
    time += 20;
    player.play("move");
    await Promise.resolve();
    time += 100;
    player.play("move");

    expect(calls).toHaveLength(2);
  });

  it("does not repeat the same cue within a moment", () => {
    let time = 1_000;
    const { spawn, calls } = fakeSpawn();
    const { player } = setup({ spawn, now: () => time });

    player.play("attention");
    time += 30;
    player.play("attention");

    expect(calls).toHaveLength(1);
  });

  it("never throws when the cue file cannot be written", () => {
    const { spawn, calls } = fakeSpawn();
    // A folder inside a regular file can't be created on any platform.
    const file = path.join(mkdtempSync(path.join(os.tmpdir(), "sable-sound-")), "plain-file");

    writeFileSync(file, "");

    const player = createSoundPlayer({ enabled: true, directory: path.join(file, "sounds"), platform: "linux", spawn, streamBackends: [] });

    expect(() => player.play("open")).not.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("writes every cue file up front, so playing never waits on the disk", () => {
    const { spawn } = fakeSpawn();
    const { directory } = setup({ spawn });

    expect(readdirSync(directory).sort()).toEqual(["attention.wav", "back.wav", "move.wav", "open.wav", "started.wav", "stopped.wav"]);
  });

  it("writes the files when sound is turned on later", () => {
    const { spawn } = fakeSpawn();
    const { directory, player } = setup({ enabled: false, spawn });

    expect(existsSync(directory)).toBe(false);

    player.setEnabled(true);

    expect(readdirSync(directory)).toHaveLength(6);
  });

  it("lets the crash chime cut a playing tone and start at once", () => {
    let time = 1_000;
    const { spawn, calls, children } = fakeSpawn();
    const { player } = setup({ spawn, now: () => time });

    player.play("started");
    time += 150;
    player.play("attention");

    expect(children[0]!.kill).toHaveBeenCalledOnce();
    expect(calls).toHaveLength(2);
    expect(calls[1]!.args[0]).toContain("attention.wav");
  });

  it("never plays over a chime, and plays again once it ends", async () => {
    let time = 1_000;
    const { spawn, calls, children } = fakeSpawn((_command, handlers) => {
      lastHandlers = handlers;
    });
    let lastHandlers: Handlers | undefined;
    const { player } = setup({ spawn, now: () => time });

    player.play("attention");
    await Promise.resolve();
    time += 300;
    player.play("started");
    player.play("move");
    expect(calls).toHaveLength(1);

    lastHandlers?.exit?.(0);
    time += 300;
    player.play("started");

    expect(calls).toHaveLength(2);
    expect(children).toHaveLength(2);
  });

  it("does not play a tick while any other sound is playing", () => {
    let time = 1_000;
    const { spawn, calls } = fakeSpawn();
    const { player } = setup({ spawn, now: () => time });

    player.play("open");
    time += 200;
    player.play("move");

    expect(calls).toHaveLength(1);
  });

  it("does not count a cut tone as a failure", async () => {
    let time = 1_000;
    const { spawn, calls } = fakeSpawn();
    const { player } = setup({ spawn, now: () => time });

    for (let index = 0; index < 6; index += 1) {
      player.play("started");
      time += 150;
      player.play("attention");
      await Promise.resolve();
      await Promise.resolve();
      time += 1_000;
    }

    expect(calls.length).toBeGreaterThan(6);
  });
});
