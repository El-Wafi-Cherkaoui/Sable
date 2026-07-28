import type { ServiceLogEntry } from "../process/process-manager.js";
import { getSelectedCommand, getSelectedService, type RuntimeWorkspaceState } from "../runtime/runtime-state.js";
import { createTuiStyle, type TuiStyle } from "./style.js";

export type RenderLogsViewOptions = {
  state: RuntimeWorkspaceState;
  logs: ServiceLogEntry[];
  scrollOffset: number;
  visibleLineCount?: number;
  viewportColumns?: number;
  color?: boolean;
  style?: TuiStyle;
};

const defaultVisibleLineCount = 20;
const defaultViewportColumns = 80;
const minimumLogBoxWidth = 20;
const maximumLogBoxWidth = 100;

export function renderLogsView(options: RenderLogsViewOptions): string {
  const style = options.style ?? createTuiStyle(options.color ?? false);
  const selectedService = getSelectedService(options.state);
  const selectedCommand = getSelectedCommand(options.state);
  const subjectLabel = selectedCommand !== undefined ? "command" : "service";
  const serviceName = selectedCommand?.command.name ?? selectedService?.service.name ?? "No service selected";
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
  const labelWidth = 9;
  const lines = [
    style.title("Logs"),
    "",
    `${style.muted("workspace".padEnd(labelWidth))} ${options.state.workspace.name}`,
    `${style.muted(subjectLabel.padEnd(labelWidth))} ${serviceName}`,
    `${style.muted("range".padEnd(labelWidth))} ${formatLogRange(normalizedScrollOffset, visibleLogs.length, options.logs.length)}`,
    "",
  ];

  const contentLines = selectedService === undefined && selectedCommand === undefined
    ? ["No item selected."]
    : options.logs.length === 0
      ? ["No logs yet.", "", "Start the service or wait for output."]
      : visibleLogs.map((entry) => formatLogEntry(entry, style));

  lines.push(...renderLogBox(
    contentLines,
    visibleLineCount,
    resolveLogBoxWidth(options.viewportColumns ?? defaultViewportColumns),
    style,
  ));

  lines.push("", style.muted("j/k scroll  Esc back  ? help  q quit"));

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

function formatLogEntry(entry: ServiceLogEntry, style: TuiStyle): string {
  return `${style.stream(entry.stream)} ${entry.line}`;
}

export function renderLogBox(
  contentLines: string[],
  visibleLineCount: number,
  width: number,
  style: TuiStyle,
): string[] {
  const paddedLines = [
    ...contentLines.slice(0, visibleLineCount),
    ...Array.from({ length: Math.max(0, visibleLineCount - contentLines.length) }, () => ""),
  ];
  const top = style.border(`┌${"─".repeat(width + 2)}┐`);
  const bottom = style.border(`└${"─".repeat(width + 2)}┘`);
  const body = paddedLines.map((line) =>
    formatLogBoxLine(line, width, style),
  );

  return [top, ...body, bottom];
}

function formatLogBoxLine(line: string, width: number, style: TuiStyle): string {
  const truncatedLine = truncateVisible(line, width);

  return `${style.border("│")} ${truncatedLine}${" ".repeat(width - visibleLength(truncatedLine))} ${style.border("│")}`;
}

function resolveLogBoxWidth(viewportColumns: number): number {
  if (!Number.isFinite(viewportColumns) || viewportColumns <= 0) {
    return 76;
  }

  return Math.max(minimumLogBoxWidth, Math.min(maximumLogBoxWidth, viewportColumns - 8));
}

export function truncateVisible(value: string, maxLength: number): string {
  if (visibleLength(value) <= maxLength) {
    return value;
  }

  return `${stripAnsi(value).slice(0, Math.max(0, maxLength - 3))}...`;
}

export function visibleLength(value: string): number {
  return stripAnsi(value).length;
}

export function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
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
