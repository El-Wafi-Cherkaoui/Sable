import { getSelectedCommand, getSelectedItem, getSelectedService, runtimeServices, type RuntimeWorkspaceState } from "../runtime/runtime-state.js";
import type { ServiceLogEntry } from "../process/process-manager.js";
import { displayPath, formatItemStatus, type ItemKind } from "./format.js";
import { formatKeyHints, type KeyHint } from "./key-hints.js";
import { appendAnchoredFooter, clipLines } from "./layout.js";
import { formatLogEntry } from "./log-lines.js";
import { createTuiStyle, type TuiStyle } from "./style.js";
import { padVisibleEnd, truncateVisible } from "./width.js";

export type RenderStaticDashboardOptions = {
  quitLabel?: string;
  statusMessage?: string;
  moving?: boolean;
  // Shows the settings key in the footer.
  settingsAvailable?: boolean;
  color?: boolean;
  style?: TuiStyle;
  // Index into the state's items of the row to flash.
  pulseItemIndex?: number;
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
  return clipLines(renderDashboardLines(state, options), options.columns);
}

function renderDashboardLines(
  state: RuntimeWorkspaceState,
  options: RenderStaticDashboardOptions,
): string {
  const style = options.style ?? createTuiStyle(options.color ?? false);
  const footer = [
    "",
    formatStatusLine(state, options, style),
    formatKeyHints(getDashboardKeyHints(state, options), style, options.columns === undefined ? undefined : options.columns - 1),
  ];
  const lines = [formatHeader(state, style), ""];

  if (state.items.length === 0) {
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

  const services = runtimeServices(state);

  if (services.length > 0) {
    const running = services.filter((serviceState) => serviceState.process.status === "running").length;

    details.push(`${running} of ${services.length} running`);
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

  // The items are already in display order, services then commands; a heading starts each group.
  let groupKind: ItemKind | undefined;

  for (const [index, itemState] of state.items.entries()) {
    const kind = itemState.item.kind;

    if (kind !== groupKind) {
      if (rows.length > 0) {
        rows.push({ type: "heading", line: "" });
      }

      rows.push({ type: "heading", line: style.muted(kind === "service" ? "SERVICES" : "COMMANDS") });
      groupKind = kind;
    }

    addRow(
      kind,
      index,
      itemState.item.name,
      formatItemStatus(itemState, style),
      index === state.selectedItemIndex,
      index === options.pulseItemIndex,
    );
  }

  return rows;
}

function sliceAroundSelection(rows: ItemRow[], state: RuntimeWorkspaceState, viewportSize: number): string[] {
  const selectedIndex = Math.max(0, rows.findIndex((row) =>
    row.type !== "heading" && row.index === state.selectedItemIndex,
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
  const selected = getSelectedItem(state);

  if (selected === undefined) {
    return [];
  }

  const waitsFor = selected.item.after.flatMap((id) => {
    const found = state.items[state.itemIndexById[id] ?? -1];

    return found === undefined ? [] : [found.item.name];
  });
  const skipped = selected.queue?.status === "skipped" ? ` · skipped: ${selected.queue.reason}` : "";
  const name = waitsFor.length === 0 ? selected.item.name : `${selected.item.name} (after ${waitsFor.join(", ")})`;

  const logs = options.selectedServiceLogs ?? [];
  const lineCount = Math.max(1, height - 1);
  const latest = logs.slice(Math.max(0, logs.length - lineCount));
  const heading = style.muted(`${name}${skipped} · ${latest.length === 0 ? "no output yet" : `last ${latest.length} lines`}`);

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
    ? `Moving service "${getSelectedService(state)?.item.name ?? ""}"`
    : options.statusMessage;

  return message === undefined ? "" : `${style.statusLabel("›")} ${message}`;
}

function getDashboardKeyHints(
  state: RuntimeWorkspaceState,
  options: RenderStaticDashboardOptions,
): KeyHint[] {
  const hints = baseDashboardKeyHints(state, options);

  // Settings sits just before the last hint (back), so narrow terminals trim it first.
  return options.settingsAvailable === true && options.moving !== true
    ? [...hints.slice(0, -1), [",", "settings"], ...hints.slice(-1)]
    : hints;
}

function baseDashboardKeyHints(
  state: RuntimeWorkspaceState,
  options: RenderStaticDashboardOptions,
): KeyHint[] {
  const back: KeyHint = ["q", options.quitLabel ?? "quit"];

  if (options.moving === true) {
    return [["↑↓", "move"], ["Enter", "done"], ["Esc", "cancel"]];
  }

  const startAll: KeyHint[] = runtimeServices(state).length > 0 ? [["S", "start all"]] : [];
  const selected = getSelectedItem(state);

  // An item the start-all plan is holding back: s cancels its start.
  if (selected?.queue?.status === "waiting") {
    return [["s", "cancel"], ["Enter", selected.item.kind === "command" ? "output" : "logs"], ["e", "edit"], ["?", "help"], ...startAll, back];
  }

  const command = getSelectedCommand(state);

  if (command !== undefined) {
    return command.process.status === "running"
      ? [["s", "stop"], ["Enter", "output"], ["e", "edit"], ["?", "help"], ...startAll, back]
      : [["r", "run"], ["Enter", "output"], ["e", "edit"], ["a", "add"], ["?", "help"], ...startAll, back];
  }

  const service = getSelectedService(state);

  if (service === undefined) {
    return [["a", "add"], ["?", "help"], back];
  }

  return service.process.status === "running"
    ? [["s", "stop"], ["r", "restart"], ["Enter", "logs"], ["e", "edit"], ["?", "help"], ...startAll, back]
    : [["s", "start"], ["Enter", "logs"], ["e", "edit"], ["a", "add"], ["?", "help"], ...startAll, back];
}

