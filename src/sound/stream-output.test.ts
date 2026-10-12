import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSoundPlayer } from "./player.js";
import { createStreamOutput, streamBackends, type StreamProcess, type StreamSpawn } from "./stream-output.js";

type Handlers = { error?: (error: NodeJS.ErrnoException) => void; exit?: (code: number | null) => void };

function fakeStream(onSpawn: (command: string, handlers: Handlers) => void = () => {}) {
  const writes: Buffer[] = [];
  const spawned: string[] = [];
  const kills: number[] = [];
  const spawn: StreamSpawn = (command) => {
    const handlers: Handlers = {};
    const child: StreamProcess = {
      stdin: {
        write: (chunk) => {
          writes.push(chunk);
          return true;
        },
        writableLength: 0,
        destroyed: false,
        on: () => {},
      },
      on(event: "error" | "exit", listener: never) {
        handlers[event] = listener;
        return child;
      },
      unref: vi.fn(),
      kill: vi.fn(() => {
        kills.push(1);
      }),
    };

    spawned.push(command);
    queueMicrotask(() => onSpawn(command, handlers));

    return child;
  };

  return { spawn, writes, spawned, kills };
}

const backend = (command: string) => ({ command, args: [] });
const loud = (buffer: Buffer) => Array.from({ length: buffer.length / 2 }, (_, index) => Math.abs(buffer.readInt16LE(index * 2))).some((value) => value > 0);
// Tones are a flat 1000; the chime is a gentle triangle, so any jump is the mixer's doing.
const samples = (cue: string) => cue === "attention"
  ? Int16Array.from({ length: 8_000 }, (_, index) => Math.min(index * 5, (8_000 - index) * 5, 1_000))
  : new Int16Array(2_000).fill(1_000);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("stream output", () => {
  it("starts the audio process once, ahead of the first cue", () => {
    const { spawn, spawned } = fakeStream();
    const output = createStreamOutput({ backends: [backend("pacat")], spawn, samplesFor: samples });

    output.open();
    output.open();
    output.play("open");
    output.play("started");

    expect(spawned).toEqual(["pacat"]);
  });

  it("writes the cue's first audio right away, with no start-up wait", () => {
    const { spawn, writes } = fakeStream();
    const output = createStreamOutput({ backends: [backend("pacat")], spawn, samplesFor: samples });

    output.open();
    output.play("open");

    // 3 chunks of 20 ms = 60 ms of lead, written in the same tick as the cue.
    expect(writes).toHaveLength(3);
    expect(loud(writes[0]!)).toBe(true);
  });

  it("keeps a steady 60 ms lead while a cue plays, then goes quiet", () => {
    const { spawn, writes } = fakeStream();
    const output = createStreamOutput({ backends: [backend("pacat")], spawn, samplesFor: samples });

    output.open();
    output.play("open");
    vi.advanceTimersByTime(1_000);

    // 2000 samples = 5 chunks of audio, plus up to 4 chunks of silence.
    const total = writes.length;

    expect(total).toBeGreaterThanOrEqual(5);
    expect(total).toBeLessThanOrEqual(10);
    expect(output.playing()).toEqual([]);

    vi.advanceTimersByTime(5_000);
    expect(writes).toHaveLength(total);
  });

  it("starts a later cue from the same short lead after idle", () => {
    const { spawn, writes } = fakeStream();
    const output = createStreamOutput({ backends: [backend("pacat")], spawn, samplesFor: samples });

    output.open();
    output.play("open");
    vi.advanceTimersByTime(2_000);
    const before = writes.length;

    output.play("started");

    expect(writes.length - before).toBe(3);
    expect(loud(writes[before]!)).toBe(true);
  });

  it("lets the chime cut a tone with a quick fade instead of a click", () => {
    const { spawn, writes } = fakeStream();
    const output = createStreamOutput({ backends: [backend("pacat")], spawn, samplesFor: samples });

    output.open();
    output.play("started");
    vi.advanceTimersByTime(20);
    output.play("attention");
    vi.advanceTimersByTime(2_000);

    const all = Buffer.concat(writes);
    const values = Array.from({ length: all.length / 2 }, (_, index) => all.readInt16LE(index * 2));
    // The first sample of the tone itself steps from silence; everything after must be smooth.
    const largestStep = Math.max(...values.slice(2).map((value, index) => Math.abs(value - values[index + 1]!)));

    expect(largestStep).toBeLessThan(50);
    expect(output.playing()).toEqual([]);
  });

  it("tries the next player when one is not installed", async () => {
    const { spawn, spawned } = fakeStream((command, handlers) => {
      if (command === "pacat") {
        handlers.error?.(Object.assign(new Error("missing"), { code: "ENOENT" }));
      }
    });
    const output = createStreamOutput({ backends: [backend("pacat"), backend("paplay")], spawn, samplesFor: samples });

    output.open();
    await vi.advanceTimersByTimeAsync(0);

    expect(spawned).toEqual(["pacat", "paplay"]);
    expect(output.failed()).toBe(false);
  });

  it("gives up when no player works, so the player can fall back", async () => {
    const { spawn } = fakeStream((_command, handlers) => {
      handlers.error?.(Object.assign(new Error("missing"), { code: "ENOENT" }));
    });
    const output = createStreamOutput({ backends: [backend("pacat"), backend("paplay")], spawn, samplesFor: samples });

    output.open();
    await vi.advanceTimersByTimeAsync(0);

    expect(output.failed()).toBe(true);
  });

  it("moves on when a player exits right away, and gives up after repeated deaths", async () => {
    const { spawn, spawned } = fakeStream((_command, handlers) => handlers.exit?.(1));
    const output = createStreamOutput({ backends: [backend("pacat"), backend("paplay")], spawn, samplesFor: samples });

    output.open();
    await vi.advanceTimersByTimeAsync(0);

    expect(spawned.slice(0, 2)).toEqual(["pacat", "paplay"]);
    expect(output.failed()).toBe(true);
  });

  it("stops the audio process on close", () => {
    const { spawn, kills } = fakeStream();
    const output = createStreamOutput({ backends: [backend("pacat")], spawn, samplesFor: samples });

    output.open();
    output.close();

    expect(kills).toHaveLength(1);
  });

  it("only offers streaming on Linux", () => {
    expect(streamBackends("linux").map((entry) => entry.command)).toEqual(["pacat", "paplay", "pw-cat", "aplay"]);
    expect(streamBackends("darwin")).toEqual([]);
    expect(streamBackends("win32")).toEqual([]);
  });
});

describe("sound player with a stream", () => {
  it("plays through the stream, not by launching a player per cue", () => {
    const stream = fakeStream();
    const files = vi.fn();
    const player = createSoundPlayer({
      enabled: true,
      directory: "/dev/null/unused",
      platform: "linux",
      streamBackends: [backend("pacat")],
      streamSpawn: stream.spawn,
      spawn: files as never,
    });

    player.play("open");

    expect(stream.spawned).toEqual(["pacat"]);
    expect(stream.writes.length).toBeGreaterThan(0);
    expect(files).not.toHaveBeenCalled();
  });

  it("closes the stream when sound is turned off and reopens it when turned on", () => {
    const stream = fakeStream();
    const player = createSoundPlayer({ enabled: true, directory: "/dev/null/unused", platform: "linux", streamBackends: [backend("pacat")], streamSpawn: stream.spawn });

    player.setEnabled(false);
    player.play("open");
    expect(stream.writes).toHaveLength(0);
    expect(stream.kills).toHaveLength(1);

    player.setEnabled(true);
    expect(stream.spawned).toEqual(["pacat", "pacat"]);
  });
});
