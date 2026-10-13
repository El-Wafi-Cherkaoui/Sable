import os from "node:os";
import path from "node:path";
import type { ManagedProcessState } from "../process/process-manager.js";
import type { RuntimeQueueState } from "../runtime/runtime-state.js";
import type { TuiStyle } from "./style.js";

export type ItemKind = "service" | "command";

// A symbol and a word, so status reads the same with or without color.
export function formatStatus(process: ManagedProcessState, kind: ItemKind, style: TuiStyle): string {
  switch (process.status) {
    case "running":
      return style.running("● running");
    case "stopped":
      return style.muted(kind === "command" ? "○ idle" : "○ stopped");
    case "failed":
      return style.failed(`✕ failed: ${firstLine(process.error.message)}`);
    case "exited":
      if (process.signal !== null) {
        return style.failed(`✕ killed (${process.signal})`);
      }

      if (process.exitCode === 0) {
        return kind === "command" ? style.running("✓ done") : style.muted("○ exited 0");
      }

      return style.failed(`✕ exited ${process.exitCode ?? "?"}`);
  }
}

// Like formatStatus, but says so while a start-all plan holds the item back or has skipped it.
// The list uses the short form (`detail` off) so it fits the narrow column; the logs header gives the reason.
export function formatItemStatus(
  itemState: { item: { kind: ItemKind }; process: ManagedProcessState; queue?: RuntimeQueueState },
  style: TuiStyle,
  options: { detail?: boolean } = {},
): string {
  if (itemState.queue?.status === "waiting") {
    return style.muted(`◌ after ${itemState.queue.for.join(", ")}`);
  }

  if (itemState.queue?.status === "skipped") {
    return style.failed(options.detail === true ? `✕ skipped: ${itemState.queue.reason}` : "✕ skipped");
  }

  return formatStatus(itemState.process, itemState.item.kind, style);
}

// Shortens paths under the home directory to ~/…, the way shells show them.
export function displayPath(directory: string, homeDirectory: string = os.homedir()): string {
  if (homeDirectory === "" || !path.isAbsolute(directory)) {
    return directory;
  }

  if (directory === homeDirectory) {
    return "~";
  }

  const relative = path.relative(homeDirectory, directory);

  return relative.startsWith("..") || path.isAbsolute(relative)
    ? directory
    : `~${path.sep}${relative}`;
}

function firstLine(message: string): string {
  return message.split(/\r?\n/, 1)[0] ?? message;
}
