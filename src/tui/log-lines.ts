import type { ServiceLogEntry } from "../process/process-manager.js";
import type { TuiStyle } from "./style.js";
import { stripAnsi } from "./width.js";

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
  // The preview is a one-line summary, so the child's own colors are left out.
  const line = stripAnsi(entry.line);
  const time = options.timestamps === true ? `${style.muted(formatClockTime(entry.timestamp))} ` : "";

  switch (entry.stream) {
    case "stderr":
      return `${time}${style.failed("▌")} ${style.failed(line)}`;
    case "system":
      return `${time}${style.muted(`· ${line}`)}`;
    case "stdout":
      return `${time}  ${line}`;
  }
}

export function formatClockTime(date: Date): string {
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

// "10-12 09:00:00": the clock time with the month and day in front, for lines from another day.
export function formatDateTime(date: Date): string {
  const day = [date.getMonth() + 1, date.getDate()].map((part) => String(part).padStart(2, "0")).join("-");

  return `${day} ${formatClockTime(date)}`;
}

// Whether a log needs dates: it starts with output saved from an earlier run, or has lines from a day
// before today. Lines are in time order, so the first one tells.
export function needsDates(logs: ReadonlyArray<{ timestamp: Date; saved?: boolean }>, now: Date = new Date()): boolean {
  const first = logs[0];

  return first !== undefined
    && (first.saved === true
      || first.timestamp.getFullYear() !== now.getFullYear()
      || first.timestamp.getMonth() !== now.getMonth()
      || first.timestamp.getDate() !== now.getDate());
}
