import { isResize } from "../input/keymap.js";
import type { KeyInput } from "../input/terminal-key-input.js";
import { dialogMaxWidth, renderDialogBox, renderDialogScreen } from "./dialog-box.js";
import { formatKeyHints } from "./key-hints.js";
import type { PromptScreen } from "./prompt-view.js";
import { createTuiStyle, shouldUseColor, type TuiStyle } from "./style.js";
import { visibleLength } from "./width.js";

export type DeleteDialogOptions = {
  title: string;
  // What gets removed, one short line per entry.
  explanation: string[];
  // The name the user types to confirm.
  name: string;
  keyInput: KeyInput;
  screen?: PromptScreen;
  background?: string;
  color?: boolean;
  columns?: number;
  rows?: number;
};

export type DeleteDialogResult = "confirm" | "back" | "exit";

// Deleting asks for the name to be typed, inside the same popup box as the
// rest of Sable, over the screen it was opened from.
export async function runDeleteDialog(options: DeleteDialogOptions): Promise<DeleteDialogResult> {
  const screen = options.screen ?? terminalScreen;
  const color = options.color ?? shouldUseColor();
  const style = createTuiStyle(color);
  let typed = "";
  let error: string | undefined;
  const render = () => {
    screen.clear();
    screen.write(`${renderDeleteDialog(options, typed, error, style, color)}\n`);
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

    if (keypress.name === "escape") {
      return "back";
    }

    if (keypress.name === "return" || keypress.sequence === "\r") {
      if (typed === options.name) {
        return "confirm";
      }

      error = `That doesn't match "${options.name}".`;
    } else if (keypress.name === "backspace") {
      typed = typed.slice(0, -1);
      error = undefined;
    } else if (keypress.sequence !== undefined && keypress.ctrl !== true && [...keypress.sequence].every((character) => character >= " " && character !== "\x7f")) {
      typed += keypress.sequence;
      error = undefined;
    } else {
      continue;
    }

    render();
  }
}

export function renderDeleteDialog(
  options: Pick<DeleteDialogOptions, "title" | "explanation" | "name" | "background" | "columns" | "rows">,
  typed: string,
  error: string | undefined,
  style: TuiStyle = createTuiStyle(false),
  color = false,
): string {
  const field = color ? `${typed}\x1b[7m \x1b[27m` : `${typed}▏`;
  const underline = "─".repeat(Math.max(visibleLength(options.name), visibleLength(typed)) + 1);
  const box = renderDialogBox({
    title: options.title,
    lines: [
      ...options.explanation,
      "",
      `Type ${style.title(options.name)} to confirm:`,
      field,
      style.muted(underline),
      // Always present, so the box doesn't change size when an error appears.
      error === undefined ? "" : style.failed(error),
    ],
    style,
    maxWidth: dialogMaxWidth(options.columns ?? process.stdout.columns),
  });

  return renderDialogScreen({
    box,
    hints: formatKeyHints([["Enter", "delete"], ["Esc", "cancel"]], style, dialogMaxWidth(options.columns ?? process.stdout.columns)),
    style,
    columns: options.columns ?? process.stdout.columns,
    rows: options.rows ?? process.stdout.rows,
    background: options.background,
  });
}

const terminalScreen: PromptScreen = {
  clear() {
    process.stdout.write("\x1b[2J\x1b[H");
  },
  write(contents) {
    process.stdout.write(contents);
  },
};
