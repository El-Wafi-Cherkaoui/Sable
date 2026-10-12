import { spawn as nodeSpawn } from "node:child_process";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { SoundOutput } from "./sound-output.js";
import { cues, renderCue, type Cue } from "./sounds.js";

export type SoundProcess = {
  on(event: "error", listener: (error: NodeJS.ErrnoException) => void): unknown;
  on(event: "exit", listener: (code: number | null) => void): unknown;
  unref(): void;
  kill(): unknown;
};

export type SoundSpawn = (command: string, args: string[]) => SoundProcess;

export type ProcessOutputOptions = {
  // Folder where the generated cue files are kept.
  directory: string;
  platform: NodeJS.Platform;
  spawn?: SoundSpawn;
};

type PlayerCommand = (file: string) => { command: string; args: string[] };

const maxFailures = 3;

// Plays each cue by starting the OS player on a small WAV file. Slower and
// less even than the audio stream, so it is used where no stream is possible
// (macOS, Windows) or the stream could not start.
export function createProcessOutput(options: ProcessOutputOptions): SoundOutput & { prepare(): void } {
  const spawn = options.spawn ?? defaultSpawn;
  const candidates = playerCommands(options.platform);
  const files = new Map<Cue, string>();
  const active = new Set<{ cue: Cue; child: SoundProcess; killed: boolean }>();
  let candidateIndex = 0;
  let failures = 0;
  let broken = false;

  const stopAll = () => {
    for (const playing of active) {
      playing.killed = true;

      try {
        playing.child.kill();
      } catch {
        // Already gone.
      }
    }

    active.clear();
  };

  // Every cue file is written up front, so playing never waits on the disk.
  const prepare = () => {
    try {
      mkdirSync(options.directory, { recursive: true });

      for (const cue of Object.keys(cues) as Cue[]) {
        if (files.has(cue)) {
          continue;
        }

        const file = path.join(options.directory, `${cue}.wav`);
        const temp = `${file}.${process.pid}.tmp`;

        writeFileSync(temp, renderCue(cue));
        renameSync(temp, file);
        files.set(cue, file);
      }
    } catch {
      broken = true;
    }
  };

  return {
    prepare,
    stopAll,
    close: stopAll,
    failed: () => broken || candidateIndex >= candidates.length,
    playing: () => [...active].map((playing) => playing.cue),
    play(cue) {
      if (files.size === 0) {
        prepare();
      }

      const file = files.get(cue);
      const candidate = candidates[candidateIndex];

      if (broken || file === undefined || candidate === undefined) {
        return;
      }

      try {
        const { command, args } = candidate(file);

        // The crash chime cuts whatever is playing, so it is never late or muddied.
        if (cue === "attention") {
          stopAll();
        }

        const child = spawn(command, args);
        const entry = { cue, child, killed: false };

        active.add(entry);
        child.unref();
        child.on("error", (error) => {
          active.delete(entry);

          if (error.code === "ENOENT") {
            // This player isn't installed; use the next one from now on.
            if (candidates[candidateIndex] === candidate) {
              candidateIndex += 1;
            }

            return;
          }

          failures += 1;
          broken ||= failures >= maxFailures;
        });
        child.on("exit", (code) => {
          active.delete(entry);

          if (entry.killed) {
            return;
          }

          if (code === 0) {
            failures = 0;
            return;
          }

          // No sound server (e.g. a headless machine): stop trying after a few misses.
          failures += 1;
          broken ||= failures >= maxFailures;
        });
      } catch {
        broken = true;
      }
    },
  };
}

function playerCommands(platform: NodeJS.Platform): PlayerCommand[] {
  if (platform === "darwin") {
    return [(file) => ({ command: "afplay", args: [file] })];
  }

  if (platform === "win32") {
    return [
      (file) => ({
        command: "powershell",
        args: ["-NoProfile", "-NonInteractive", "-Command", `(New-Object Media.SoundPlayer '${file.replaceAll("'", "''")}').PlaySync()`],
      }),
    ];
  }

  return [
    (file) => ({ command: "paplay", args: [file] }),
    (file) => ({ command: "pw-play", args: [file] }),
    (file) => ({ command: "aplay", args: ["-q", file] }),
  ];
}

const defaultSpawn: SoundSpawn = (command, args) => nodeSpawn(command, args, { stdio: "ignore", windowsHide: true });
