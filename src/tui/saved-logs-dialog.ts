import { isResize } from "../input/keymap.js";
import type { KeyInput } from "../input/terminal-key-input.js";
import { dialogMaxWidth, renderDialogBox, renderDialogScreen } from "./dialog-box.js";
import { formatKeyHints, type KeyHint } from "./key-hints.js";
import type { PromptScreen } from "./prompt-view.js";
import { createTuiStyle, shouldUseColor, type TuiStyle } from "./style.js";
import { padVisibleEnd, truncateVisible } from "./width.js";

export type SavedLogRow = {
  label: string;
  bytes: number;
};

export type SavedLogsDialogOptions = {
  title: string;
  // The first row is the broad one ("Everything ..."); the rest are single items or workspaces.
  load(): Promise<SavedLogRow[]>;
  remove(index: number): Promise<void>;
  // Shown under the list, e.g. to say saving is switched off.
  note?: string;
  keyInput: KeyInput;
  // The screen the popup opened from; it stays visible, dimmed, around the box.
  background?: string;
  screen?: PromptScreen;
  color?: boolean;
  columns?: number;
  rows?: number;
};

export type SavedLogsDialogResult = "close" | "exit";

type DialogState = {
  rows: SavedLogRow[];
  selected: number;
  // The row waiting for "yes, delete it".
  confirming: boolean;
  message?: string;
};

// A popup listing what is saved and how big it is. ↑↓ choose a row, d (or Enter) asks to delete it,
// Enter confirms and Esc keeps it. Nothing is deleted without that second step.
export async function runSavedLogsDialog(options: SavedLogsDialogOptions): Promise<SavedLogsDialogResult> {
  const screen = options.screen ?? terminalScreen;
  const style = createTuiStyle(options.color ?? shouldUseColor());
  let state: DialogState = { rows: await options.load(), selected: 0, confirming: false };
  const render = () => {
    screen.clear();
    screen.write(`${renderSavedLogsDialog(options, state, style, options.columns ?? process.stdout.columns, options.rows ?? process.stdout.rows)}\n`);
  };

  render();

  while (true) {
    const keypress = await options.keyInput.readKey();

    if (isResize(keypress)) {
      render();
      continue;
    }

    if (keypress.ctrl === true && keypress.name === "c") {
      return "exit";
    }

    const enter = keypress.name === "return" || keypress.sequence === "\r";

    if (state.confirming) {
      if (enter) {
        const label = state.rows[state.selected]!.label;

        await options.remove(state.selected);
        state = { rows: await options.load(), selected: state.selected, confirming: false, message: `Deleted the saved logs of ${label}.` };
      } else if (keypress.name === "escape" || keypress.sequence === "n" || keypress.sequence === "q") {
        state = { ...state, confirming: false, message: undefined };
      } else {
        continue;
      }
    } else if (keypress.name === "escape" || keypress.sequence === "q") {
      return "close";
    } else if (keypress.name === "up" || keypress.name === "down") {
      const step = keypress.name === "down" ? 1 : -1;

      state = { ...state, selected: (state.selected + step + state.rows.length) % state.rows.length, message: undefined };
    } else if (enter || keypress.sequence === "d") {
      const row = state.rows[state.selected]!;

      state = row.bytes === 0
        ? { ...state, message: `Nothing is saved for ${row.label}.` }
        : { ...state, confirming: true, message: undefined };
    } else {
      continue;
    }

    render();
  }
}

export function renderSavedLogsDialog(
  options: Pick<SavedLogsDialogOptions, "title" | "note" | "background">,
  state: DialogState,
  style: TuiStyle = createTuiStyle(false),
  columns = 80,
  rows?: number,
): string {
  const labelWidth = Math.min(32, Math.max(...state.rows.map((row) => row.label.length)));
  const sizeWidth = Math.max(...state.rows.map((row) => formatBytes(row.bytes).length));
  // Box chrome (borders, padding), the message and note lines and the hints under the box.
  const room = rows === undefined ? state.rows.length : Math.max(3, rows - 10);
  const windowed = state.rows.length > room;
  const size = windowed ? room - 1 : state.rows.length;
  const start = windowed ? Math.max(0, Math.min(state.selected - Math.floor(size / 2), state.rows.length - size)) : 0;
  const list = state.rows.slice(start, start + size).map((row, offset) => {
    const index = start + offset;
    const marker = index === state.selected ? ">" : " ";
    const bytes = row.bytes === 0 ? style.muted("nothing saved".padStart(sizeWidth)) : formatBytes(row.bytes).padStart(sizeWidth);

    return `${marker} ${padVisibleEnd(truncateVisible(row.label, labelWidth), labelWidth)}   ${bytes}`;
  });
  const selected = state.rows[state.selected];
  const lines = [
    ...list,
    ...(windowed ? [style.muted(`${start > 0 ? `↑ ${start} more` : ""}${start > 0 && start + size < state.rows.length ? " · " : ""}${start + size < state.rows.length ? `↓ ${state.rows.length - start - size} more` : ""}`)] : []),
    "",
    state.confirming && selected !== undefined
      ? style.failed(`Delete the saved logs of ${selected.label} (${formatBytes(selected.bytes)})?`)
      : (state.message ?? options.note ?? ""),
  ];
  const hints: KeyHint[] = state.confirming
    ? [["Enter", "delete"], ["Esc", "keep"]]
    : [["↑↓", "select"], ["d", "delete"], ["Esc", "close"]];

  return renderDialogScreen({
    box: renderDialogBox({ title: options.title, lines, style, maxWidth: dialogMaxWidth(columns) }),
    hints: formatKeyHints(hints, style, dialogMaxWidth(columns)),
    style,
    columns,
    rows,
    background: options.background,
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10} ${units[unit]}`;
}

const terminalScreen: PromptScreen = {
  clear() {
    process.stdout.write("\x1b[2J\x1b[H");
  },
  write(contents) {
    process.stdout.write(contents);
  },
};
