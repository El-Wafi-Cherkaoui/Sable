import { isResize } from "../input/keymap.js";
import type { KeyInput } from "../input/terminal-key-input.js";
import { dialogMaxWidth, renderDialogBox, renderDialogScreen } from "./dialog-box.js";
import { formatKeyHints } from "./key-hints.js";
import type { PromptScreen } from "./prompt-view.js";
import { createTuiStyle, shouldUseColor, type TuiStyle } from "./style.js";
import { wrapWords } from "./wrap-words.js";

export type NoticeDialogOptions = {
  title: string;
  // Paragraphs; each is wrapped to the box. An empty string is a blank line.
  paragraphs: string[];
  keyInput: KeyInput;
  screen?: PromptScreen;
  color?: boolean;
  columns?: number;
  rows?: number;
};

export type NoticeDialogResult = "ok" | "exit";

const textWidth = 64;

// A popup that tells the user something once. Enter, Esc or q closes it.
export async function runNoticeDialog(options: NoticeDialogOptions): Promise<NoticeDialogResult> {
  const screen = options.screen ?? terminalScreen;
  const style = createTuiStyle(options.color ?? shouldUseColor());
  const render = () => {
    screen.clear();
    screen.write(`${renderNoticeDialog(options, style, options.columns ?? process.stdout.columns, options.rows ?? process.stdout.rows)}\n`);
  };

  render();

  while (true) {
    const keypress = await options.keyInput.readKey();

    if (isResize(keypress)) {
      render();
    } else if (keypress.ctrl === true && keypress.name === "c") {
      return "exit";
    } else if (keypress.name === "return" || keypress.sequence === "\r" || keypress.name === "escape" || keypress.sequence === "q") {
      return "ok";
    }
  }
}

export function renderNoticeDialog(
  options: Pick<NoticeDialogOptions, "title" | "paragraphs">,
  style: TuiStyle = createTuiStyle(false),
  columns = 80,
  rows?: number,
): string {
  const width = Math.min(textWidth, Math.max(16, (dialogMaxWidth(columns) ?? textWidth) - 6));
  const lines = options.paragraphs.flatMap((paragraph) => paragraph === "" ? [""] : wrapWords(paragraph, width));

  return renderDialogScreen({
    box: renderDialogBox({ title: options.title, lines: [...lines, "", style.key(" OK ")], centered: [lines.length + 1], style, maxWidth: dialogMaxWidth(columns) }),
    hints: formatKeyHints([["Enter", "OK"]], style, dialogMaxWidth(columns)),
    style,
    columns,
    rows,
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
