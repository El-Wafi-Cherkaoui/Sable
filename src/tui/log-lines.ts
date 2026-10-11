import type { ServiceLogEntry } from "../process/process-manager.js";
import type { TuiStyle } from "./style.js";

export type FormatLogEntryOptions = {
  timestamps?: boolean;
};

// stdout is plain text, stderr gets a red bar, and Sable's own lifecycle
// messages are dimmed so they read as annotations rather than output.
export function formatLogEntry(
  entry: ServiceLogEntry,
  style: TuiStyle,
  options: FormatLogEntryOptions = {},
): string {
  const time = options.timestamps === true ? `${style.muted(formatClockTime(entry.timestamp))} ` : "";

  switch (entry.stream) {
    case "stderr":
      return `${time}${style.failed("▌")} ${style.failed(entry.line)}`;
    case "system":
      return `${time}${style.muted(`· ${entry.line}`)}`;
    case "stdout":
      return `${time}  ${entry.line}`;
  }
}

export function formatClockTime(date: Date): string {
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}
