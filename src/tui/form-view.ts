import type { Keypress } from "../input/keymap.js";
import type { KeyInput } from "../input/terminal-key-input.js";
import { formatKeyHints, type KeyHint } from "./key-hints.js";
import type { PromptScreen } from "./prompt-view.js";
import { createTuiStyle, shouldUseColor, type TuiStyle } from "./style.js";
import { padVisibleEnd } from "./width.js";

export type FormField =
  | { type: "text"; key: string; label: string; hint?: string }
  | { type: "toggle"; key: string; label: string }
  | { type: "choice"; key: string; label: string; choices: Array<{ value: string; label: string }> }
  | { type: "list"; key: string; label: string; hint?: string; addLabel: string };

export type FormValue = string | boolean | string[];
export type FormValues = Record<string, FormValue>;

// Errors are keyed by field key, or `${key}.${index}` for one item of a list field.
export type FormErrors = Record<string, string>;

export type RunFormOptions = {
  title: string;
  subtitle?: string;
  fields: (values: FormValues) => FormField[];
  values: FormValues;
  validate?: (values: FormValues) => FormErrors;
  keyInput: KeyInput;
  screen?: PromptScreen;
  color?: boolean;
  columns?: number;
};

export type FormResult =
  | { type: "submit"; values: FormValues }
  | { type: "back" }
  | { type: "exit" };

type FormRow =
  | { kind: "field"; field: FormField }
  | { kind: "item"; field: Extract<FormField, { type: "list" }>; index: number }
  | { kind: "add"; field: Extract<FormField, { type: "list" }> };

export type FormState = {
  values: FormValues;
  focus: number;
  cursor: number;
  errors: FormErrors;
};

export async function runForm(options: RunFormOptions): Promise<FormResult> {
  const screen = options.screen ?? terminalScreen;
  const color = options.color ?? shouldUseColor();
  const style = createTuiStyle(color);
  let state: FormState = {
    values: cloneValues(options.values),
    focus: 0,
    cursor: textOf(options.values, firstRow(options))?.length ?? 0,
    errors: {},
  };
  const render = () => renderFrame(screen, renderForm(options, state, style, color, options.columns ?? process.stdout.columns));

  render();

  while (true) {
    const keypress = await options.keyInput.readKey();

    if (keypress.ctrl === true && keypress.name === "c") {
      return { type: "exit" };
    }

    if (keypress.name === "escape") {
      return { type: "back" };
    }

    if (keypress.ctrl === true && keypress.name === "s") {
      const submitted = trySubmit(options, state);

      if (submitted.type === "submit") {
        return submitted;
      }

      state = submitted.state;
      render();
      continue;
    }

    const rows = buildRows(options.fields(state.values), state.values);
    const isLastRow = state.focus >= rows.length - 1;

    if ((keypress.name === "return" || keypress.sequence === "\r") && rows[state.focus]?.kind !== "add" && isLastRow) {
      const submitted = trySubmit(options, state);

      if (submitted.type === "submit") {
        return submitted;
      }

      state = submitted.state;
      render();
      continue;
    }

    state = applyFormKey(options, state, keypress);
    render();
  }
}

// Pure state transition for one key, so editing behavior is testable without a terminal.
export function applyFormKey(options: Pick<RunFormOptions, "fields">, state: FormState, keypress: Keypress & { shift?: boolean }): FormState {
  const rows = buildRows(options.fields(state.values), state.values);
  const row = rows[state.focus];

  if (row === undefined) {
    return state;
  }

  const moveTo = (focus: number): FormState => {
    const nextRows = buildRows(options.fields(state.values), state.values);
    const clamped = Math.max(0, Math.min(focus, nextRows.length - 1));

    return { ...state, focus: clamped, cursor: textOf(state.values, nextRows[clamped])?.length ?? 0 };
  };

  if (keypress.name === "up" || (keypress.name === "tab" && keypress.shift === true)) {
    return moveTo(state.focus - 1);
  }

  if (keypress.name === "down" || keypress.name === "tab") {
    return moveTo(state.focus + 1);
  }

  if (keypress.name === "return" || keypress.sequence === "\r") {
    if (row.kind === "add") {
      const items = [...listOf(state.values, row.field.key), ""];
      const values = { ...state.values, [row.field.key]: items };

      return { ...state, values, focus: state.focus, cursor: 0 };
    }

    return moveTo(state.focus + 1);
  }

  if (row.kind === "field" && (row.field.type === "toggle" || row.field.type === "choice")) {
    if (keypress.name === "space" || keypress.sequence === " " || keypress.name === "left" || keypress.name === "right") {
      return { ...withoutError(state, row.field.key), values: { ...state.values, [row.field.key]: cycle(row.field, state.values[row.field.key], keypress.name === "left" ? -1 : 1) } };
    }

    return state;
  }

  if (row.kind === "add") {
    return state;
  }

  const errorKey = row.kind === "item" ? `${row.field.key}.${row.index}` : row.field.key;
  const text = textOf(state.values, row) ?? "";
  const setText = (value: string, cursor: number): FormState => ({
    ...withoutError(state, errorKey),
    values: row.kind === "item"
      ? { ...state.values, [row.field.key]: listOf(state.values, row.field.key).map((item, index) => index === row.index ? value : item) }
      : { ...state.values, [row.field.key]: value },
    cursor,
  });

  switch (keypress.name) {
    case "left":
      return { ...state, cursor: Math.max(0, state.cursor - 1) };
    case "right":
      return { ...state, cursor: Math.min(text.length, state.cursor + 1) };
    case "home":
      return { ...state, cursor: 0 };
    case "end":
      return { ...state, cursor: text.length };
    case "backspace":
      if (row.kind === "item" && text.length === 0) {
        const items = listOf(state.values, row.field.key).filter((_, index) => index !== row.index);

        return { ...state, values: { ...state.values, [row.field.key]: items }, focus: Math.max(0, state.focus - 1), cursor: 0 };
      }

      return state.cursor === 0 ? state : setText(text.slice(0, state.cursor - 1) + text.slice(state.cursor), state.cursor - 1);
    case "delete":
      return setText(text.slice(0, state.cursor) + text.slice(state.cursor + 1), state.cursor);
  }

  const sequence = keypress.sequence;

  if (sequence !== undefined && keypress.ctrl !== true && isPrintable(sequence)) {
    return setText(text.slice(0, state.cursor) + sequence + text.slice(state.cursor), state.cursor + sequence.length);
  }

  return state;
}

export function renderForm(
  options: Pick<RunFormOptions, "title" | "subtitle" | "fields">,
  state: FormState,
  style: TuiStyle = createTuiStyle(false),
  color = false,
  columns = 80,
): string {
  const fields = options.fields(state.values);
  const rows = buildRows(fields, state.values);
  const labelWidth = Math.max(...fields.map((field) => field.label.length)) + 2;
  const valueWidth = Math.max(10, columns - labelWidth - 5);
  const lines = [`${style.title(options.title)}${options.subtitle === undefined ? "" : style.muted(` · ${options.subtitle}`)}`, ""];

  for (const [index, row] of rows.entries()) {
    const focused = index === state.focus;
    const label = row.kind === "field" || (row.kind === "item" && row.index === 0) || (row.kind === "add" && listOf(state.values, row.field.key).length === 0)
      ? row.field.label
      : "";
    const value = renderRowValue(row, state, focused, style, color, valueWidth);
    const line = `${focused ? "> " : "  "}${padVisibleEnd(label, labelWidth)}${value}`;

    lines.push(focused && color ? style.selected(padVisibleEnd(line, Math.min(columns - 1, labelWidth + valueWidth + 3))) : line);

    const errorKey = row.kind === "item" ? `${row.field.key}.${row.index}` : row.kind === "field" ? row.field.key : undefined;
    const error = errorKey === undefined ? undefined : state.errors[errorKey];
    const indent = " ".repeat(labelWidth + 2);

    if (error !== undefined) {
      lines.push(`${indent}${style.failed(error)}`);
    } else if (focused && "hint" in row.field && row.field.hint !== undefined && row.kind !== "add") {
      lines.push(`${indent}${style.muted(row.field.hint)}`);
    }
  }

  lines.push("", formatKeyHints(getFormKeyHints(rows[state.focus]), style));

  return lines.join("\n");
}

function renderRowValue(row: FormRow, state: FormState, focused: boolean, style: TuiStyle, color: boolean, width: number): string {
  if (row.kind === "add") {
    return focused ? `+ ${row.field.addLabel}` : style.muted(`+ ${row.field.addLabel}`);
  }

  if (row.kind === "field" && row.field.type === "toggle") {
    return state.values[row.field.key] === true ? "yes" : "no";
  }

  if (row.kind === "field" && row.field.type === "choice") {
    const current = state.values[row.field.key];

    return row.field.choices
      .map((choice) => choice.value === current ? style.title(choice.label) : style.muted(choice.label))
      .join(style.muted(" / "));
  }

  const text = textOf(state.values, row) ?? "";

  return focused ? renderWithCursor(text, state.cursor, color, width) : truncateEnd(text, width);
}

// Shows a window of the text that keeps the cursor visible, with a block cursor
// in color terminals and a thin bar otherwise.
function renderWithCursor(text: string, cursor: number, color: boolean, width: number): string {
  const start = Math.max(0, Math.min(cursor - width + 2, text.length - width + 1));
  const visible = text.slice(start, start + width - 1);
  const at = cursor - start;
  const before = visible.slice(0, at);
  const under = visible.slice(at, at + 1);
  const after = visible.slice(at + 1);
  const prefix = start > 0 ? "…" : "";

  return color
    ? `${prefix}${before}\x1b[7m${under === "" ? " " : under}\x1b[27m${after}`
    : `${prefix}${before}▏${under}${after}`;
}

function truncateEnd(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, width - 1)}…`;
}

function getFormKeyHints(row: FormRow | undefined): KeyHint[] {
  const change: KeyHint[] = row?.kind === "field" && (row.field.type === "toggle" || row.field.type === "choice")
    ? [["Space", "change"]]
    : row?.kind === "add"
      ? [["Enter", "add"]]
      : [];

  return [["↑↓", "field"], ...change, ["Ctrl+S", "save"], ["Esc", "cancel"]];
}

function trySubmit(
  options: RunFormOptions,
  state: FormState,
): { type: "submit"; values: FormValues } | { type: "invalid"; state: FormState } {
  const values = withoutBlankItems(options.fields(state.values), state.values);
  const errors = options.validate?.(values) ?? {};

  if (Object.keys(errors).length === 0) {
    return { type: "submit", values };
  }

  const rows = buildRows(options.fields(values), values);
  const firstInvalid = rows.findIndex((row) =>
    (row.kind === "field" && errors[row.field.key] !== undefined) ||
    (row.kind === "item" && errors[`${row.field.key}.${row.index}`] !== undefined),
  );
  const focus = firstInvalid >= 0 ? firstInvalid : state.focus;

  return {
    type: "invalid",
    state: { values, errors, focus, cursor: textOf(values, rows[focus])?.length ?? 0 },
  };
}

function buildRows(fields: FormField[], values: FormValues): FormRow[] {
  return fields.flatMap((field): FormRow[] => field.type === "list"
    ? [
      ...listOf(values, field.key).map((_, index) => ({ kind: "item" as const, field, index })),
      { kind: "add" as const, field },
    ]
    : [{ kind: "field" as const, field }]);
}

function firstRow(options: RunFormOptions): FormRow | undefined {
  return buildRows(options.fields(options.values), options.values)[0];
}

function textOf(values: FormValues, row: FormRow | undefined): string | undefined {
  if (row === undefined) {
    return undefined;
  }

  if (row.kind === "item") {
    return listOf(values, row.field.key)[row.index];
  }

  if (row.kind === "field" && row.field.type === "text") {
    const value = values[row.field.key];

    return typeof value === "string" ? value : "";
  }

  return undefined;
}

function listOf(values: FormValues, key: string): string[] {
  const value = values[key];

  return Array.isArray(value) ? value : [];
}

function cycle(field: Extract<FormField, { type: "toggle" | "choice" }>, current: FormValue | undefined, step: number): FormValue {
  if (field.type === "toggle") {
    return current !== true;
  }

  const index = field.choices.findIndex((choice) => choice.value === current);
  const next = (index + step + field.choices.length) % field.choices.length;

  return field.choices[next]!.value;
}

function withoutError(state: FormState, key: string): FormState {
  if (state.errors[key] === undefined) {
    return state;
  }

  const errors = { ...state.errors };

  delete errors[key];

  return { ...state, errors };
}

function withoutBlankItems(fields: FormField[], values: FormValues): FormValues {
  const next = { ...values };

  for (const field of fields) {
    if (field.type === "list") {
      next[field.key] = listOf(values, field.key).filter((item) => item.trim() !== "");
    }
  }

  return next;
}

function cloneValues(values: FormValues): FormValues {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value]));
}

function isPrintable(sequence: string): boolean {
  return sequence.length >= 1 && [...sequence].every((character) => character >= " " && character !== "\x7f");
}

function renderFrame(screen: PromptScreen, contents: string): void {
  screen.clear();
  screen.write(`${contents}\n`);
}

const terminalScreen: PromptScreen = {
  clear() {
    process.stdout.write("\x1b[2J\x1b[H");
  },
  write(contents) {
    process.stdout.write(contents);
  },
};
