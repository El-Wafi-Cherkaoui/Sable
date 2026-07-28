import type { RuntimeWorkspaceState } from "../runtime/runtime-state.js";
import type { ManagedProcessState, ServiceLogEntry } from "../process/process-manager.js";
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
  const dashboardFooter = style.muted(`j/k select  ? help  q ${
    options.quitLabel ?? "quit"
  }`);
  const statusLine = formatDashboardStatusLine(options.statusMessage, style);
  const lines = [style.muted("Workspace"), style.title(state.workspace.name), ""];

  if (state.services.length === 0) {
    lines.push("No services yet.");
    lines.push("");
    lines.push("Press a to add a service to this workspace.");
    lines.push("", statusLine, dashboardFooter);
    return lines.join("\n");
  }

  if (shouldRenderWideDashboard(options.columns)) {
    return renderWideDashboard(state, lines, statusLine, dashboardFooter, options, style);
  }

  const nameColumnWidth = Math.max(
    "Service".length,
    ...state.services.map((serviceState) => serviceState.service.name.length),
  );

  lines.push(style.muted(`  ${"Service".padEnd(nameColumnWidth)}  Status`));

  for (const [index, serviceState] of state.services.entries()) {
    const line = `  ${serviceState.service.name.padEnd(nameColumnWidth)}  ${formatProcessState(
      serviceState.process,
      style,
    )}`;

    lines.push(index === state.selectedServiceIndex ? style.selected(line) : line);
  }

  lines.push("", statusLine, dashboardFooter);

  return lines.join("\n");
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

function renderWideDashboard(
  state: RuntimeWorkspaceState,
  lines: string[],
  statusLine: string,
  dashboardFooter: string,
  options: RenderStaticDashboardOptions,
  style: TuiStyle,
): string {
  const columns = options.columns ?? wideDashboardColumns;
  const previewBoxWidth = columns - serviceColumnWidth - dashboardColumnGap - 5;

  if (previewBoxWidth < minimumPreviewBoxWidth) {
    return renderStaticDashboard(state, { ...options, columns: undefined });
  }

  const bodyAvailableRows = resolveBodyAvailableRows(lines.length, options.rows);
  const serviceViewportSize = Math.max(1, bodyAvailableRows - 1);
  const previewVisibleLineCount = Math.max(3, bodyAvailableRows - 3);
  const selectedIndex = state.selectedServiceIndex ?? 0;
  const serviceViewportStart = resolveServiceViewportStart(
    selectedIndex,
    state.services.length,
    serviceViewportSize,
  );
  const serviceRows = renderServiceRows(
    state,
    serviceViewportStart,
    serviceViewportSize,
    style,
  );
  const selectedServiceName = state.services[selectedIndex]?.service.name ?? "No service selected";
  const previewRows = renderPreviewRows(
    selectedServiceName,
    options.selectedServiceLogs ?? [],
    previewVisibleLineCount,
    previewBoxWidth,
    style,
  );
  const header = `${style.muted(`Services ${selectedIndex + 1}/${state.services.length}`)}`;
  const previewHeader = style.muted(`Logs · ${selectedServiceName}`);
  const bodyRows = [
    joinColumns(header, previewHeader, serviceColumnWidth),
    ...joinColumnRows(serviceRows, previewRows, serviceColumnWidth),
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

function resolveServiceViewportStart(
  selectedIndex: number,
  serviceCount: number,
  viewportSize: number,
): number {
  if (serviceCount <= viewportSize) {
    return 0;
  }

  const halfViewport = Math.floor(viewportSize / 2);
  const preferredStart = selectedIndex - halfViewport;

  return Math.max(0, Math.min(preferredStart, serviceCount - viewportSize));
}

function renderServiceRows(
  state: RuntimeWorkspaceState,
  viewportStart: number,
  viewportSize: number,
  style: TuiStyle,
): string[] {
  const visibleServices = state.services.slice(viewportStart, viewportStart + viewportSize);
  const nameWidth = 14;

  return visibleServices.map((serviceState, offset) => {
    const index = viewportStart + offset;
    const serviceName = truncateVisible(serviceState.service.name, nameWidth);
    const line = truncateVisible(`  ${serviceName}${" ".repeat(nameWidth - visibleLength(serviceName))}  ${formatProcessState(
      serviceState.process,
      style,
    )}`, serviceColumnWidth);

    return index === state.selectedServiceIndex ? style.selected(line) : line;
  });
}

function renderPreviewRows(
  selectedServiceName: string,
  logs: ServiceLogEntry[],
  visibleLineCount: number,
  width: number,
  style: TuiStyle,
): string[] {
  const latestLogs = logs.slice(Math.max(0, logs.length - visibleLineCount));
  const contentLines = selectedServiceName === "No service selected"
    ? ["No service selected."]
    : latestLogs.length === 0
      ? ["No logs yet."]
      : latestLogs.map((entry) => `${style.stream(entry.stream)} ${entry.line}`);

  return renderLogBox(contentLines, visibleLineCount, width, style);
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
