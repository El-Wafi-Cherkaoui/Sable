import type { ServiceLogEntry } from "../process/process-manager.js";
import { getSelectedCommand, getSelectedService, type RuntimeWorkspaceState } from "../runtime/runtime-state.js";
import { formatStatus } from "./format.js";
import { formatKeyHints, type KeyHint } from "./key-hints.js";
import { formatClockTime } from "./log-lines.js";
import { createTuiStyle, type TuiStyle } from "./style.js";
import { sliceVisibleStart, truncateVisible, visibleLength } from "./width.js";
export { stripAnsi, truncateVisible, visibleLength } from "./width.js";

// How many rows the log body has, how wide they are, and whether long lines wrap.
export type LogsLayout = {
  height: number;
  width: number;
  wrap: boolean;
};

export type LogsSearch = {
  query: string;
  editing: boolean;
};

export type RenderLogsViewOptions = {
  state: RuntimeWorkspaceState;
  logs: ServiceLogEntry[];
  scrollOffset: number;
  following?: boolean;
  visibleLineCount?: number;
  revealLineCount?: number;
  horizontalScrollOffset?: number;
  viewportColumns?: number;
  wrap?: boolean;
  search?: LogsSearch;
  highlightIndex?: number;
  message?: string;
  color?: boolean;
  style?: TuiStyle;
};

const defaultVisibleLineCount = 20;
const defaultViewportColumns = 80;
// Gutter (2) + "HH:MM:SS " (9) + stream mark (2).
const prefixWidth = 13;

export function renderLogsView(options: RenderLogsViewOptions): string {
  const style = options.style ?? createTuiStyle(options.color ?? false);
  const color = options.color === true;
  const layout = resolveLayout(options);
  const offset = clampScrollOffset(options.scrollOffset, options.logs, layout);
  const lines = [formatHeader(options, offset, style), ""];
  const body = renderBody(options, offset, layout, style, color);

  lines.push(...body, ...Array.from({ length: Math.max(0, layout.height - body.length) }, () => ""));
  lines.push("", formatSearchLine(options, style), formatKeyHints(getLogsKeyHints(options), style, layout.width));

  return lines.join("\n");
}

export function bottomScrollOffset(logs: ServiceLogEntry[], layout: LogsLayout): number {
  if (!layout.wrap) {
    return Math.max(0, logs.length - layout.height);
  }

  let rows = 0;

  for (let index = logs.length - 1; index >= 0; index -= 1) {
    rows += rowCount(logs[index]!, layout);

    if (rows > layout.height) {
      return index + 1;
    }
  }

  return 0;
}

export function clampScrollOffset(offset: number, logs: ServiceLogEntry[], layout: LogsLayout): number {
  return Math.max(0, Math.min(offset, bottomScrollOffset(logs, layout)));
}

export function findMatches(logs: ServiceLogEntry[], query: string): number[] {
  const needle = query.toLowerCase();

  if (needle === "") {
    return [];
  }

  return logs.flatMap((entry, index) => entry.stream !== "system" && entry.line.toLowerCase().includes(needle) ? [index] : []);
}

// The next index in `candidates` after `from` (or before, going backwards), wrapping around.
export function nextIndex(candidates: number[], from: number | undefined, direction: 1 | -1): number | undefined {
  if (candidates.length === 0) {
    return undefined;
  }

  if (from === undefined) {
    return direction === 1 ? candidates[0] : candidates.at(-1);
  }

  return direction === 1
    ? candidates.find((index) => index > from) ?? candidates[0]
    : [...candidates].reverse().find((index) => index < from) ?? candidates.at(-1);
}

export function errorIndexes(logs: ServiceLogEntry[]): number[] {
  return logs.flatMap((entry, index) => entry.stream === "stderr" ? [index] : []);
}

function resolveLayout(options: RenderLogsViewOptions): LogsLayout {
  return {
    height: options.visibleLineCount ?? defaultVisibleLineCount,
    width: Math.max(prefixWidth + 10, (options.viewportColumns ?? defaultViewportColumns) - 1),
    wrap: options.wrap === true,
  };
}

function formatHeader(options: RenderLogsViewOptions, offset: number, style: TuiStyle): string {
  const command = getSelectedCommand(options.state);
  const service = getSelectedService(options.state);
  const name = command?.command.name ?? service?.service.name;

  if (name === undefined) {
    return style.title("Logs");
  }

  const status = command !== undefined
    ? formatStatus(command.process, "command", style)
    : formatStatus(service!.process, "service", style);
  const count = options.logs.length;
  const position = options.following !== false || count === 0 ? "following" : `from line ${(offset + 1).toLocaleString("en-US")}`;

  return [
    style.title(name),
    style.muted(` · ${options.state.workspace.name} · `),
    status,
    style.muted(` · ${count.toLocaleString("en-US")} ${count === 1 ? "line" : "lines"} · ${position}`),
  ].join("");
}

function renderBody(
  options: RenderLogsViewOptions,
  offset: number,
  layout: LogsLayout,
  style: TuiStyle,
  color: boolean,
): string[] {
  if (getSelectedCommand(options.state) === undefined && getSelectedService(options.state) === undefined) {
    return ["  No item selected."];
  }

  if (options.logs.length === 0) {
    return ["  No output yet. Start it with s, or wait for it to print something."];
  }

  const rows: string[] = [];
  const limit = options.revealLineCount ?? Number.POSITIVE_INFINITY;
  const query = options.search?.editing === false ? options.search.query : "";

  for (let index = offset; index < options.logs.length && rows.length < layout.height && index - offset < limit; index += 1) {
    const entryRows = renderEntry(options.logs[index]!, index === options.highlightIndex, query, options.horizontalScrollOffset ?? 0, layout, style, color);

    rows.push(...entryRows.slice(0, layout.height - rows.length));
  }

  return rows;
}

function renderEntry(
  entry: ServiceLogEntry,
  highlighted: boolean,
  query: string,
  horizontalScrollOffset: number,
  layout: LogsLayout,
  style: TuiStyle,
  color: boolean,
): string[] {
  const gutter = highlighted ? "> " : "  ";
  const time = formatClockTime(entry.timestamp);

  if (entry.stream === "system") {
    const label = `── ${entry.line} · ${time} `;

    return [`${gutter}${style.muted(truncateVisible(`${label}${"─".repeat(Math.max(0, layout.width - 2 - visibleLength(label)))}`, layout.width - 2))}`];
  }

  const contentWidth = layout.width - prefixWidth;
  const mark = entry.stream === "stderr" ? `${style.failed("▌")} ` : "  ";
  const paint = (text: string) => {
    const marked = color && query !== "" ? markMatches(text, query) : text;

    return entry.stream === "stderr" ? style.failed(marked) : marked;
  };
  const prefix = `${gutter}${style.muted(time)} ${mark}`;
  const decorate = (row: string) => highlighted && color ? style.selected(row) : row;

  if (!layout.wrap) {
    const shifted = horizontalScrollOffset > 0 ? sliceVisibleStart(entry.line, horizontalScrollOffset) : entry.line;

    return [decorate(`${prefix}${paint(truncateVisible(shifted, contentWidth))}`)];
  }

  const chunks = chunkText(entry.line, contentWidth);
  const indent = " ".repeat(prefixWidth);

  return chunks.map((chunk, index) => decorate(`${index === 0 ? prefix : indent}${paint(chunk)}`));
}

function rowCount(entry: ServiceLogEntry, layout: LogsLayout): number {
  if (!layout.wrap || entry.stream === "system") {
    return 1;
  }

  return Math.max(1, Math.ceil(visibleLength(entry.line) / (layout.width - prefixWidth)));
}

function chunkText(text: string, width: number): string[] {
  if (text === "") {
    return [""];
  }

  const chunks: string[] = [];
  let rest = text;

  while (rest !== "") {
    const taken = sliceToWidth(rest, width);

    chunks.push(taken);
    rest = rest.slice(taken.length);
  }

  return chunks;
}

function sliceToWidth(text: string, width: number): string {
  let result = "";

  for (const character of text) {
    if (visibleLength(result + character) > width) {
      break;
    }

    result += character;
  }

  return result === "" ? [...text][0] ?? "" : result;
}

function markMatches(text: string, query: string): string {
  const lower = text.toLowerCase();
  const needle = query.toLowerCase();
  let result = "";
  let position = 0;

  for (let found = lower.indexOf(needle); found !== -1; found = lower.indexOf(needle, position)) {
    result += `${text.slice(position, found)}\x1b[7m${text.slice(found, found + needle.length)}\x1b[27m`;
    position = found + needle.length;
  }

  return result + text.slice(position);
}

function formatSearchLine(options: RenderLogsViewOptions, style: TuiStyle): string {
  if (options.message !== undefined) {
    return `${style.statusLabel("›")} ${options.message}`;
  }

  const search = options.search;

  if (search === undefined) {
    return "";
  }

  if (search.editing) {
    return `${style.statusLabel("/")}${search.query}▏`;
  }

  const matches = findMatches(options.logs, search.query);
  const current = options.highlightIndex === undefined ? -1 : matches.indexOf(options.highlightIndex);
  const summary = matches.length === 0
    ? "no matches"
    : current >= 0 ? `match ${current + 1} of ${matches.length}` : `${matches.length} matches`;

  return `${style.statusLabel("/")}${search.query}  ${style.muted(summary)}`;
}

function getLogsKeyHints(options: RenderLogsViewOptions): KeyHint[] {
  if (options.search?.editing === true) {
    return [["Enter", "find"], ["Esc", "cancel"]];
  }

  if (options.search !== undefined) {
    return [["n", "next"], ["N", "previous"], ["/", "new search"], ["Esc", "clear"]];
  }

  // Ordered by importance: on narrow terminals hints are dropped from just before "back".
  return [
    ["/", "search"],
    ["e", "next error"],
    ["w", options.wrap === true ? "no wrap" : "wrap"],
    ["G", "follow"],
    ["↑↓", "scroll"],
    ["Esc", "back"],
  ];
}
