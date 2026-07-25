import type { ServiceLogEntry } from "../process/process-manager.js";
import { getSelectedService, type RuntimeWorkspaceState } from "../runtime/runtime-state.js";

export type RenderLogsViewOptions = {
  state: RuntimeWorkspaceState;
  logs: ServiceLogEntry[];
  scrollOffset: number;
  visibleLineCount?: number;
};

const defaultVisibleLineCount = 20;

export function renderLogsView(options: RenderLogsViewOptions): string {
  const selectedService = getSelectedService(options.state);
  const serviceName = selectedService?.service.name ?? "No service selected";
  const visibleLineCount = options.visibleLineCount ?? defaultVisibleLineCount;
  const normalizedScrollOffset = clampScrollOffset(
    options.scrollOffset,
    options.logs.length,
    visibleLineCount,
  );
  const visibleLogs = options.logs.slice(
    normalizedScrollOffset,
    normalizedScrollOffset + visibleLineCount,
  );
  const lines = [
    `${options.state.workspace.name} / ${serviceName} logs`,
    formatLogRange(normalizedScrollOffset, visibleLogs.length, options.logs.length),
    "",
  ];

  if (selectedService === undefined) {
    lines.push("No service selected.");
  } else if (options.logs.length === 0) {
    lines.push("No logs captured yet.");
  } else {
    lines.push(...visibleLogs.map(formatLogEntry));
  }

  lines.push("", "j/k scroll  g top  G bottom  Esc back  ? help  : command  q quit");

  return lines.join("\n");
}

export function clampScrollOffset(
  scrollOffset: number,
  logLineCount: number,
  visibleLineCount: number,
): number {
  return Math.max(0, Math.min(scrollOffset, maxScrollOffset(logLineCount, visibleLineCount)));
}

export function maxScrollOffset(logLineCount: number, visibleLineCount: number): number {
  return Math.max(0, logLineCount - visibleLineCount);
}

function formatLogEntry(entry: ServiceLogEntry): string {
  return `${entry.stream.padEnd(6)} ${entry.line}`;
}

function formatLogRange(
  scrollOffset: number,
  visibleLogCount: number,
  totalLogCount: number,
): string {
  if (totalLogCount === 0) {
    return "0 lines";
  }

  return `lines ${scrollOffset + 1}-${scrollOffset + visibleLogCount} of ${totalLogCount}`;
}
