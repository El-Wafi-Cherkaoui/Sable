import { promises as fs, statSync } from "node:fs";
import path from "node:path";
import type { ItemKind } from "../config/config-types.js";
import type { ServiceLogEntry } from "../process/process-manager.js";

export type LogTarget = { workspace: string; name: string; kind: ItemKind };

export type LogFilesOptions = {
  // Where the log folders go, e.g. <config folder>/logs.
  directory: string;
  // Checked for every line, so switching the setting takes effect at once.
  isEnabled(): boolean;
  // A file is moved aside (keeping one older copy) once it would grow past this.
  maxBytes?: number;
  flushMs?: number;
};

export type LogUsage = { bytes: number; files: number };

export type LogFiles = {
  // Queues a line; it reaches the file within a moment.
  append(target: LogTarget, entry: ServiceLogEntry): void;
  // The last lines saved before this run of Sable first touched the file.
  readEarlier(target: LogTarget, maxLines: number): Promise<ServiceLogEntry[]>;
  pathFor(target: LogTarget): string;
  // How much is saved for one item (its file and the older copy), a whole workspace, or everything.
  usage(target: LogTarget): Promise<LogUsage>;
  workspaceUsage(workspace: string): Promise<LogUsage>;
  totalUsage(): Promise<LogUsage>;
  // Deletes saved logs. Lines still waiting to be written are written first, so they go too; an item
  // that is still running simply starts a new file with its next line.
  remove(targets: LogTarget[]): Promise<void>;
  removeWorkspace(workspace: string): Promise<void>;
  removeAll(): Promise<void>;
  flush(): Promise<void>;
  close(): Promise<void>;
};

export const defaultMaxLogFileBytes = 2 * 1024 * 1024;
const flushNowBytes = 64 * 1024;
const earlierReadBytes = 256 * 1024;
const failuresBeforeGivingUp = 3;
const lineFormat = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z) \[(stdout|stderr|system)\] (.*)$/;

// Appends everything an item prints to a file of its own, so it can be read after Sable is closed.
// Writes are batched, never block the screen, and never throw: a full disk or a read-only folder
// just means the lines are not saved.
export function createLogFiles(options: LogFilesOptions): LogFiles {
  const maxBytes = options.maxBytes ?? defaultMaxLogFileBytes;
  const flushMs = options.flushMs ?? 250;
  const pending = new Map<string, string[]>();
  const sizes = new Map<string, number>();
  // How much of each file was there before this run first used it: that part is "earlier output".
  const startOffsets = new Map<string, number>();
  const failures = new Map<string, number>();
  let pendingBytes = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let chain: Promise<void> = Promise.resolve();

  const touch = (file: string): number => {
    const known = sizes.get(file);

    if (known !== undefined) {
      return known;
    }

    let size = 0;

    try {
      size = statSync(file).size;
    } catch {
      // No file yet.
    }

    sizes.set(file, size);
    startOffsets.set(file, size);

    return size;
  };

  const writeAll = async (): Promise<void> => {
    const batches = [...pending.entries()];

    pending.clear();
    pendingBytes = 0;

    for (const [file, lines] of batches) {
      if ((failures.get(file) ?? 0) >= failuresBeforeGivingUp) {
        continue;
      }

      const text = lines.join("");
      const bytes = Buffer.byteLength(text);

      try {
        await fs.mkdir(path.dirname(file), { recursive: true });

        if (touch(file) > 0 && touch(file) + bytes > maxBytes) {
          await fs.rm(`${file}.1`, { force: true });
          await fs.rename(file, `${file}.1`);
          sizes.set(file, 0);
          // What was "earlier" now sits in the older copy.
          startOffsets.set(file, 0);
        }

        await fs.appendFile(file, text, "utf8");
        sizes.set(file, (sizes.get(file) ?? 0) + bytes);
        failures.delete(file);
      } catch {
        failures.set(file, (failures.get(file) ?? 0) + 1);
      }
    }
  };

  // Drops what is remembered about a file, or about every file under a folder (a prefix ending in a separator),
  // so the next line written to it starts from what is actually on disk.
  const forget = (fileOrFolder: string): void => {
    for (const map of [sizes, startOffsets, failures]) {
      for (const key of [...map.keys()]) {
        if (key === fileOrFolder || (fileOrFolder.endsWith(path.sep) && key.startsWith(fileOrFolder))) {
          map.delete(key);
        }
      }
    }
  };

  const flush = (): Promise<void> => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }

    chain = chain.then(writeAll, writeAll);

    return chain;
  };

  return {
    append(target, entry) {
      if (!options.isEnabled()) {
        return;
      }

      const file = filePath(options.directory, target);
      const line = `${entry.timestamp.toISOString()} [${entry.stream}] ${entry.line}\n`;

      touch(file);
      pending.set(file, [...(pending.get(file) ?? []), line]);
      pendingBytes += line.length;

      if (pendingBytes >= flushNowBytes) {
        void flush();
      } else if (timer === undefined) {
        timer = setTimeout(() => void flush(), flushMs);
        timer.unref();
      }
    },

    async readEarlier(target, maxLines) {
      if (!options.isEnabled()) {
        return [];
      }

      const file = filePath(options.directory, target);
      const end = touch(file) === 0 ? 0 : (startOffsets.get(file) ?? 0);

      if (end === 0) {
        return [];
      }

      try {
        const handle = await fs.open(file, "r");

        try {
          const start = Math.max(0, end - earlierReadBytes);
          const buffer = Buffer.alloc(end - start);
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
          const lines = buffer.subarray(0, bytesRead).toString("utf8").split("\n");

          // Reading from the middle of the file starts inside a line; that first piece is not usable.
          return parseLines(start > 0 ? lines.slice(1) : lines).slice(-maxLines);
        } finally {
          await handle.close();
        }
      } catch {
        return [];
      }
    },

    pathFor: (target) => filePath(options.directory, target),

    async usage(target) {
      return sizeOfFiles([filePath(options.directory, target), `${filePath(options.directory, target)}.1`]);
    },

    workspaceUsage: (workspace) => sizeOfFolder(workspaceFolder(options.directory, workspace)),

    totalUsage: () => sizeOfFolder(options.directory),

    async remove(targets) {
      await flush();

      for (const target of targets) {
        const file = filePath(options.directory, target);

        await fs.rm(file, { force: true });
        await fs.rm(`${file}.1`, { force: true });
        forget(file);
      }
    },

    async removeWorkspace(workspace) {
      await flush();

      const folder = workspaceFolder(options.directory, workspace);

      await fs.rm(folder, { recursive: true, force: true });
      forget(folder + path.sep);
    },

    async removeAll() {
      await flush();
      await fs.rm(options.directory, { recursive: true, force: true });
      forget(options.directory + path.sep);
    },

    flush,

    async close() {
      await flush();
    },
  };
}

function workspaceFolder(directory: string, workspace: string): string {
  return path.join(directory, safeSegment(workspace));
}

async function sizeOfFiles(files: string[]): Promise<LogUsage> {
  let usage: LogUsage = { bytes: 0, files: 0 };

  for (const file of files) {
    try {
      const stats = await fs.stat(file);

      if (stats.isFile()) {
        usage = { bytes: usage.bytes + stats.size, files: usage.files + 1 };
      }
    } catch {
      // Not there: nothing saved.
    }
  }

  return usage;
}

async function sizeOfFolder(folder: string): Promise<LogUsage> {
  let usage: LogUsage = { bytes: 0, files: 0 };
  let entries: Array<import("node:fs").Dirent>;

  try {
    entries = await fs.readdir(folder, { withFileTypes: true });
  } catch {
    return usage;
  }

  for (const entry of entries) {
    const inner = entry.isDirectory()
      ? await sizeOfFolder(path.join(folder, entry.name))
      : entry.isFile() ? await sizeOfFiles([path.join(folder, entry.name)]) : { bytes: 0, files: 0 };

    usage = { bytes: usage.bytes + inner.bytes, files: usage.files + inner.files };
  }

  return usage;
}

function filePath(directory: string, target: LogTarget): string {
  return path.join(directory, safeSegment(target.workspace), `${safeSegment(target.name)}${target.kind === "command" ? ".command" : ""}.log`);
}

// A name made safe to use as a file or folder name on any system.
export function safeSegment(name: string): string {
  const cleaned = [...name]
    .map((character) => (character < " " || '<>:"/\\|?*'.includes(character) ? "_" : character))
    .join("")
    .replace(/^[\s.]+|[\s.]+$/g, "");
  const base = cleaned === "" ? "_" : cleaned.slice(0, 80);

  return /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(base) ? `_${base}` : base;
}

function parseLines(lines: string[]): ServiceLogEntry[] {
  const entries: ServiceLogEntry[] = [];

  for (const raw of lines) {
    const match = lineFormat.exec(raw);

    if (match !== null) {
      entries.push({ stream: match[2] as ServiceLogEntry["stream"], line: match[3]!, timestamp: new Date(match[1]!), saved: true });
    }
  }

  return entries;
}
