import type { RuntimeWorkspaceState } from "../runtime/runtime-state.js";
import type { ManagedProcessState, ServiceLogEntry } from "../process/process-manager.js";
import { appendAnchoredFooter } from "./layout.js";
import { renderLogBox, truncateVisible, visibleLength } from "./logs-view.js";
import { createTuiStyle, type TuiStyle } from "./style.js";

export type RenderStaticDashboardOptions = {
  quitLabel?: string;
  statusMessage?: string;
  color?: boolean;
  style?: TuiStyle;
  selectedServiceLogs?: ServiceLogEntry[];
  columns?: number;
  rows?: number;
};

const wideDashboardColumns = 100;
const serviceColumnWidth = 34;
const dashboardColumnGap = 3;
const minimumPreviewBoxWidth = 30;

export function renderStaticDashboard(
  state: RuntimeWorkspaceState,
  options: RenderStaticDashboardOptions = {},
): string {
  const style = options.style ?? createTuiStyle(options.color ?? false);
  const shouldPadSelectedRows = options.color === true;
  const dashboardFooter = style.muted(`j/k select  ? help  q ${
    options.quitLabel ?? "quit"
  }`);
  const statusLine = formatDashboardStatusLine(
    options.statusMessage ?? formatSelectedItemDescription(state),
    style,
  );
  const lines = [`${style.muted("Workspace:")} ${style.title(state.workspace.name)}`, ""];

  if (state.services.length === 0 && state.commands.length === 0) {
    lines.push("No services or commands yet.");
    lines.push("");
    lines.push("Press a to add a service to this workspace.");
    appendAnchoredFooter(lines, ["", statusLine, dashboardFooter], options.rows);
    return lines.join("\n");
  }

  if (shouldRenderWideDashboard(options.columns)) {
    return renderWideDashboard(state, lines, statusLine, dashboardFooter, options, style, shouldPadSelectedRows);
  }

  if (state.services.length > 0) {
    appendServiceSection(lines, state, style, shouldPadSelectedRows);
  }

  if (state.commands.length > 0) {
    if (state.services.length > 0) {
      lines.push("");
    }

    appendCommandSection(lines, state, style, shouldPadSelectedRows);
  }

  appendAnchoredFooter(lines, ["", statusLine, dashboardFooter], options.rows);

  return lines.join("\n");
}

function appendServiceSection(
  lines: string[],
  state: RuntimeWorkspaceState,
  style: TuiStyle,
  shouldPadSelectedRows: boolean,
): void {
  const nameColumnWidth = Math.max(
    "Service".length,
    ...state.services.map((serviceState) => serviceState.service.name.length),
  );

  const serviceLines = state.services.map((serviceState) => `  ${serviceState.service.name.padEnd(nameColumnWidth)}  ${formatProcessState(
    serviceState.process,
    style,
  )}`);
  const tableWidth = Math.max(
    visibleLength(`  ${"Service".padEnd(nameColumnWidth)}  Status`),
    ...serviceLines.map((line) => visibleLength(line)),
  );

  lines.push(style.muted(`  ${"Service".padEnd(nameColumnWidth)}  Status`));

  for (const [index, line] of serviceLines.entries()) {
    lines.push(index === state.selectedServiceIndex ? style.selected(
      shouldPadSelectedRows ? padVisibleEnd(line, tableWidth) : line,
    ) : line);
  }
}

function appendCommandSection(
  lines: string[],
  state: RuntimeWorkspaceState,
  style: TuiStyle,
  shouldPadSelectedRows: boolean,
): void {
  const nameColumnWidth = Math.max(
    "Command".length,
    ...state.commands.map((commandState) => commandState.command.name.length),
  );
  const commandLines = state.commands.map((commandState) => `  ${commandState.command.name.padEnd(nameColumnWidth)}  ${formatCommandProcessState(
    commandState.process,
    style,
  )}`);
  const tableWidth = Math.max(
    visibleLength(`  ${"Command".padEnd(nameColumnWidth)}  Status`),
    ...commandLines.map((line) => visibleLength(line)),
  );

  lines.push(style.muted(`  ${"Command".padEnd(nameColumnWidth)}  Status`));

  for (const [index, line] of commandLines.entries()) {
    lines.push(index === state.selectedCommandIndex ? style.selected(
      shouldPadSelectedRows ? padVisibleEnd(line, tableWidth) : line,
    ) : line);
  }
}

function formatProcessState(process: ManagedProcessState, style: TuiStyle): string {
  switch (process.status) {
    case "failed":
      return style.failed(`failed: ${formatDetail(process.error.message)}`);
    case "exited":
      if (process.signal !== null) {
        return style.exited(`exited signal ${process.signal}`);
      }

      return style.exited(`exited code ${process.exitCode ?? "null"}`);
    case "running":
      return style.running("running");
    case "stopped":
      return style.muted("stopped");
  }
}

function formatCommandProcessState(process: ManagedProcessState, style: TuiStyle): string {
  if (process.status === "exited" && process.exitCode === 0 && process.signal === null) {
    return style.running("success");
  }

  if (process.status === "stopped") {
    return style.muted("idle");
  }

  return formatProcessState(process, style);
}

function renderWideDashboard(
  state: RuntimeWorkspaceState,
  lines: string[],
  statusLine: string,
  dashboardFooter: string,
  options: RenderStaticDashboardOptions,
  style: TuiStyle,
  shouldPadSelectedRows: boolean,
): string {
  const columns = options.columns ?? wideDashboardColumns;
  const previewBoxWidth = columns - serviceColumnWidth - dashboardColumnGap - 5;

  if (previewBoxWidth < minimumPreviewBoxWidth) {
    return renderStaticDashboard(state, { ...options, columns: undefined });
  }

  const bodyAvailableRows = resolveBodyAvailableRows(lines.length, options.rows);
  const itemViewportSize = Math.max(1, bodyAvailableRows - 1);
  const previewVisibleLineCount = Math.max(3, bodyAvailableRows - 3);
  const itemRows = renderWideItemRows(
    state,
    itemViewportSize,
    style,
    shouldPadSelectedRows,
  );
  const selectedItemName = getSelectedItemName(state);
  const previewRows = renderPreviewRows(
    selectedItemName,
    options.selectedServiceLogs ?? [],
    previewVisibleLineCount,
    previewBoxWidth,
    style,
  );
  const header = style.muted(formatWideItemHeader(state));
  const previewHeader = style.muted(`Logs · ${selectedItemName}`);
  const bodyRows = [
    joinColumns(header, previewHeader, serviceColumnWidth),
    ...joinColumnRows(itemRows, previewRows, serviceColumnWidth),
  ];

  lines.push(...bodyRows, "", statusLine, dashboardFooter);

  return lines.join("\n");
}

function shouldRenderWideDashboard(columns: number | undefined): boolean {
  return columns !== undefined && columns >= wideDashboardColumns;
}

function resolveBodyAvailableRows(currentLineCount: number, rows: number | undefined): number {
  if (rows === undefined || rows <= 0) {
    return 12;
  }

  return Math.max(5, rows - currentLineCount - 4);
}

function formatDashboardStatusLine(
  statusMessage: string | undefined,
  style: TuiStyle,
): string {
  if (statusMessage === undefined) {
    return "";
  }

  return `${style.statusLabel("Status:")} ${statusMessage}`;
}

function formatSelectedItemDescription(state: RuntimeWorkspaceState): string | undefined {
  if (state.selectedCommandIndex !== undefined) {
    return "Command runs once; use r to run, s to stop while running, Enter for output.";
  }

  if (state.selectedServiceIndex !== undefined) {
    return "Service stays running; use S start, s stop, r restart, Enter for logs.";
  }

  return "Add services for long-running processes or commands for one-shot work.";
}

function resolveViewportStart(
  selectedIndex: number,
  itemCount: number,
  viewportSize: number,
): number {
  if (itemCount <= viewportSize) {
    return 0;
  }

  const halfViewport = Math.floor(viewportSize / 2);
  const preferredStart = selectedIndex - halfViewport;

  return Math.max(0, Math.min(preferredStart, itemCount - viewportSize));
}

type WideItemRow =
  | { type: "heading"; line: string }
  | { type: "service"; index: number; line: string }
  | { type: "command"; index: number; line: string };

function renderWideItemRows(
  state: RuntimeWorkspaceState,
  viewportSize: number,
  style: TuiStyle,
  shouldPadSelectedRows: boolean,
): string[] {
  const rows = createWideItemRows(state, style);
  const selectedRowIndex = Math.max(0, rows.findIndex((row) =>
    (row.type === "service" && state.selectedServiceIndex === row.index) ||
    (row.type === "command" && state.selectedCommandIndex === row.index),
  ));
  const viewportStart = resolveViewportStart(selectedRowIndex, rows.length, viewportSize);
  const visibleRows = rows.slice(viewportStart, viewportStart + viewportSize);

  return visibleRows.map((row) => {
    if (row.type === "heading") {
      return style.muted(row.line);
    }

    const isSelected = row.type === "service"
      ? row.index === state.selectedServiceIndex
      : row.index === state.selectedCommandIndex;

    return isSelected ? style.selected(
      shouldPadSelectedRows ? padVisibleEnd(row.line, serviceColumnWidth) : row.line,
    ) : row.line;
  });
}

function createWideItemRows(
  state: RuntimeWorkspaceState,
  style: TuiStyle,
): WideItemRow[] {
  const nameWidth = 14;
  const rows: WideItemRow[] = [];

  if (state.services.length > 0) {
    rows.push({ type: "heading", line: "Services" });
  }

  for (const [index, serviceState] of state.services.entries()) {
    const serviceName = truncateVisible(serviceState.service.name, nameWidth);
    const line = truncateVisible(`  ${serviceName}${" ".repeat(nameWidth - visibleLength(serviceName))}  ${formatProcessState(
      serviceState.process,
      style,
    )}`, serviceColumnWidth);

    rows.push({ type: "service", index, line });
  }

  if (state.commands.length > 0) {
    if (rows.length > 0) {
      rows.push({ type: "heading", line: "" });
    }

    rows.push({ type: "heading", line: "Commands" });
  }

  for (const [index, commandState] of state.commands.entries()) {
    const commandName = truncateVisible(commandState.command.name, nameWidth);
    const line = truncateVisible(`  ${commandName}${" ".repeat(nameWidth - visibleLength(commandName))}  ${formatCommandProcessState(
      commandState.process,
      style,
    )}`, serviceColumnWidth);

    rows.push({ type: "command", index, line });
  }

  return rows;
}

function formatWideItemHeader(state: RuntimeWorkspaceState): string {
  if (state.selectedCommandIndex !== undefined) {
    return `Commands ${state.selectedCommandIndex + 1}/${state.commands.length}`;
  }

  if (state.selectedServiceIndex !== undefined) {
    return `Services ${state.selectedServiceIndex + 1}/${state.services.length}`;
  }

  return "Items 0/0";
}

function padVisibleEnd(value: string, width: number): string {
  return `${value}${" ".repeat(Math.max(0, width - visibleLength(value)))}`;
}

function renderPreviewRows(
  selectedItemName: string,
  logs: ServiceLogEntry[],
  visibleLineCount: number,
  width: number,
  style: TuiStyle,
): string[] {
  const latestLogs = logs.slice(Math.max(0, logs.length - visibleLineCount));
  const contentLines = selectedItemName === "No item selected"
    ? ["No service selected."]
    : latestLogs.length === 0
      ? ["No logs yet."]
      : latestLogs.map((entry) => `${style.stream(entry.stream)} ${entry.line}`);

  return renderLogBox(contentLines, visibleLineCount, width, style);
}

function getSelectedItemName(state: RuntimeWorkspaceState): string {
  if (state.selectedCommandIndex !== undefined) {
    return state.commands[state.selectedCommandIndex]?.command.name ?? "No item selected";
  }

  if (state.selectedServiceIndex !== undefined) {
    return state.services[state.selectedServiceIndex]?.service.name ?? "No item selected";
  }

  return "No item selected";
}

function joinColumnRows(leftRows: string[], rightRows: string[], leftWidth: number): string[] {
  const rowCount = Math.max(leftRows.length, rightRows.length);

  return Array.from({ length: rowCount }, (_, index) =>
    joinColumns(leftRows[index] ?? "", rightRows[index] ?? "", leftWidth),
  );
}

function joinColumns(left: string, right: string, leftWidth: number): string {
  const truncatedLeft = truncateVisible(left, leftWidth);
  const paddedLeft = `${truncatedLeft}${" ".repeat(Math.max(0, leftWidth - visibleLength(truncatedLeft)))}`;

  return `${paddedLeft}${" ".repeat(dashboardColumnGap)}${right}`;
}

function formatDetail(message: string): string {
  const normalizedMessage = message.trim().replace(/\s+/g, " ");

  if (normalizedMessage.length <= 60) {
    return normalizedMessage;
  }

  return `${normalizedMessage.slice(0, 57)}...`;
}
