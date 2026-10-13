import type { ServiceLogEntry } from "../process/process-manager.js";
import type { RuntimeItemState } from "./runtime-state.js";

const recentLines = 80;
const keepLocal = "only for you";

// A short, plain explanation for an item that came from a project's sable.json and has failed here,
// with what to do about it. Such an item was written for someone else's machine, so a failure is
// often a difference in setup rather than a bug. Items made on this machine get no hint.
export function explainFailure(itemState: RuntimeItemState | undefined, logs: ServiceLogEntry[]): string | undefined {
  if (itemState === undefined || itemState.item.fromProject === undefined) {
    return undefined;
  }

  const process = itemState.process;
  const failed = process.status === "failed" || (process.status === "exited" && process.signal === null && process.exitCode !== 0);

  if (!failed) {
    return undefined;
  }

  if (process.status === "failed" && /working folder not found/i.test(process.error.message)) {
    return `Its folder isn't on this machine. Press e to change it, ${keepLocal}.`;
  }

  const output = logs.slice(-recentLines).map((entry) => entry.line).join("\n");
  const missing = /(?:^|[\s:'"])([\w.@/+-]+): (?:command )?not found/m.exec(output)?.[1]
    ?? /'([^']+)' is not recognized as an internal or external command/i.exec(output)?.[1];

  if (missing !== undefined || (process.status === "exited" && process.exitCode === 127)) {
    const program = missing === undefined ? "A program it runs" : `"${missing}"`;

    return `${program} isn't installed here, or isn't on PATH. Install it, or press e to use another command, ${keepLocal}.`;
  }

  if (/EADDRINUSE|address already in use|port \d* ?(?:is )?(?:already )?in use/i.test(output)) {
    return `A port it needs is already in use here. Free it, or press e to use another port, ${keepLocal}.`;
  }

  return `From sable.json, so it may expect a setup you don't have. Read the logs (Enter) or press e to adjust it, ${keepLocal}.`;
}
