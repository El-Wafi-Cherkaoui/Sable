import { getSelectedCommand, getSelectedService, type RuntimeWorkspaceState } from "../runtime/runtime-state.js";
import type { ServiceLogEntry } from "../process/process-manager.js";
import { displayPath, formatStatus, type ItemKind } from "./format.js";
import { formatKeyHints, type KeyHint } from "./key-hints.js";
import { appendAnchoredFooter } from "./layout.js";
import { formatLogEntry } from "./log-lines.js";
import { createTuiStyle, type TuiStyle } from "./style.js";
import { padVisibleEnd, truncateVisible } from "./width.js";

export type RenderStaticDashboardOptions = {
  quitLabel?: string;
  statusMessage?: string;
  moving?: boolean;
  color?: boolean;
  style?: TuiStyle;
  pulseServiceIndex?: number;
  pulseCommandIndex?: number;
  selectedServiceLogs?: ServiceLogEntry[];
  columns?: number;
  rows?: number;
};

const wideDashboardColumns = 100;
const itemColumnWidth = 34;
const columnGap = 3;
const minimumPreviewWidth = 30;
const nameWidth = 14;

type ItemRow =
  | { type: "heading"; line: string }
  | { type: ItemKind; index: number; line: string };

export function renderStaticDashboard(
  state: RuntimeWorkspaceState,
  options: RenderStaticDashboardOptions = {},
): string {
  const style = options.style ?? createTuiStyle(options.color ?? false);
  const footer = [
    "",
    formatStatusLine(state, options, style),
    formatKeyHints(getDashboardKeyHints(state, options), style),
  ];
  const lines = [formatHeader(state, style), ""];

  if (state.services.length === 0 && state.commands.length === 0) {
    lines.push(
      "No services or commands yet.",
      "",
      style.muted("Services keep running, like a dev server or a worker."),
      style.muted("Commands run once, like a migration or a build."),
      "",
      "Press a to add one.",
    );
    appendAnchoredFooter(lines, footer, options.rows);
    return lines.join("\n");
  }

  const columns = options.columns;
  const wide = columns !== undefined && columns >= wideDashboardColumns && columns - itemColumnWidth - columnGap >= minimumPreviewWidth;
  const rows = createItemRows(state, style, options, wide ? itemColumnWidth : Math.max(itemColumnWidth, (columns ?? 80) - 1));

  if (wide) {
    const bodyRows = resolveBodyRows(lines.length + footer.length, options.rows);
    const itemRows = sliceAroundSelection(rows, state, bodyRows).map((row) => padVisibleEnd(row, itemColumnWidth));
    // One column short of the edge: writing the last column makes some terminals wrap.
    const previewRows = renderPreview(state, options, style, columns - itemColumnWidth - columnGap - 1, bodyRows);

    for (let index = 0; index < Math.max(itemRows.length, previewRows.length); index += 1) {
      const left = itemRows[index] ?? " ".repeat(itemColumnWidth);
      const right = previewRows[index] ?? "";

      lines.push(right === "" ? left.trimEnd() : `${left}${" ".repeat(columnGap)}${right}`);
    }
  } else {
    lines.push(...rows.map((row) => row.line));
  }

  appendAnchoredFooter(lines, footer, options.rows);

  return lines.join("\n");
}

function formatHeader(state: RuntimeWorkspaceState, style: TuiStyle): string {
  const details: string[] = [];

  if (state.workspace.projectDirectory !== undefined) {
    details.push(displayPath(state.workspace.projectDirectory));
  }

  if (state.services.length > 0) {
    const running = state.services.filter((serviceState) => serviceState.process.status === "running").length;

    details.push(`${running} of ${state.services.length} running`);
  }

  const suffix = details.length === 0 ? "" : style.muted(` · ${details.join(" · ")}`);

  return `${style.title(state.workspace.name)}${suffix}`;
}

function createItemRows(
  state: RuntimeWorkspaceState,
  style: TuiStyle,
  options: RenderStaticDashboardOptions,
  rowWidth: number,
): ItemRow[] {
  const rows: ItemRow[] = [];
  const color = options.color === true;

  const addRow = (kind: ItemKind, index: number, name: string, statusText: string, selected: boolean, pulsed: boolean) => {
    const marker = selected ? "> " : "  ";
    const shownName = truncateVisible(name, nameWidth);
    const line = truncateVisible(`${marker}${padVisibleEnd(shownName, nameWidth)}  ${statusText}`, rowWidth);
    const padded = color ? padVisibleEnd(line, rowWidth) : line;

    rows.push({
      type: kind,
      index,
      line: pulsed ? style.pulse(padded) : selected ? style.selected(padded) : line,
    });
  };

  if (state.services.length > 0) {
    rows.push({ type: "heading", line: style.muted("SERVICES") });
  }

  for (const [index, serviceState] of state.services.entries()) {
    addRow(
      "service",
      index,
      serviceState.service.name,
      formatStatus(serviceState.process, "service", style),
      index === state.selectedServiceIndex,
      index === options.pulseServiceIndex,
    );
  }

  if (state.commands.length > 0) {
    if (rows.length > 0) {
      rows.push({ type: "heading", line: "" });
    }

    rows.push({ type: "heading", line: style.muted("COMMANDS") });
  }

  for (const [index, commandState] of state.commands.entries()) {
    addRow(
      "command",
      index,
      commandState.command.name,
      formatStatus(commandState.process, "command", style),
      index === state.selectedCommandIndex,
      index === options.pulseCommandIndex,
    );
  }

  return rows;
}

function sliceAroundSelection(rows: ItemRow[], state: RuntimeWorkspaceState, viewportSize: number): string[] {
  const selectedIndex = Math.max(0, rows.findIndex((row) =>
    (row.type === "service" && row.index === state.selectedServiceIndex) ||
    (row.type === "command" && row.index === state.selectedCommandIndex),
  ));
  const start = rows.length <= viewportSize
    ? 0
    : Math.max(0, Math.min(selectedIndex - Math.floor(viewportSize / 2), rows.length - viewportSize));

  return rows.slice(start, start + viewportSize).map((row) => row.line);
}

function renderPreview(
  state: RuntimeWorkspaceState,
  options: RenderStaticDashboardOptions,
  style: TuiStyle,
  width: number,
  height: number,
): string[] {
  const name = getSelectedCommand(state)?.command.name ?? getSelectedService(state)?.service.name;

  if (name === undefined) {
    return [];
  }

  const logs = options.selectedServiceLogs ?? [];
  const lineCount = Math.max(1, height - 1);
  const latest = logs.slice(Math.max(0, logs.length - lineCount));
  const heading = style.muted(latest.length === 0 ? `${name} · no output yet` : `${name} · last ${latest.length} lines`);

  return [
    heading,
    ...latest.map((entry) => truncateVisible(formatLogEntry(entry, style), width)),
  ];
}

function resolveBodyRows(reservedLines: number, rows: number | undefined): number {
  if (rows === undefined || rows <= 0) {
    return 12;
  }

  return Math.max(5, rows - reservedLines - 1);
}

function formatStatusLine(
  state: RuntimeWorkspaceState,
  options: RenderStaticDashboardOptions,
  style: TuiStyle,
): string {
  const message = options.moving === true
    ? `Moving service "${getSelectedService(state)?.service.name ?? ""}"`
    : options.statusMessage;

  return message === undefined ? "" : `${style.statusLabel("›")} ${message}`;
}

function getDashboardKeyHints(
  state: RuntimeWorkspaceState,
  options: RenderStaticDashboardOptions,
): KeyHint[] {
  const back: KeyHint = ["q", options.quitLabel ?? "quit"];

  if (options.moving === true) {
    return [["↑↓", "move"], ["Enter", "done"], ["Esc", "cancel"]];
  }

  const command = getSelectedCommand(state);

  if (command !== undefined) {
    return command.process.status === "running"
      ? [["s", "stop"], ["Enter", "output"], ["e", "edit"], ["?", "help"], back]
      : [["r", "run"], ["Enter", "output"], ["e", "edit"], ["a", "add"], ["?", "help"], back];
  }

  const service = getSelectedService(state);

  if (service === undefined) {
    return [["a", "add"], ["?", "help"], back];
  }

  return service.process.status === "running"
    ? [["s", "stop"], ["r", "restart"], ["Enter", "logs"], ["e", "edit"], ["?", "help"], back]
    : [["s", "start"], ["Enter", "logs"], ["e", "edit"], ["a", "add"], ["?", "help"], back];
}

