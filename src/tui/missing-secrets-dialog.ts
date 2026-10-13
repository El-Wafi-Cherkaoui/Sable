import { isResize } from "../input/keymap.js";
import type { KeyInput } from "../input/terminal-key-input.js";
import { dialogMaxWidth, renderDialogBox, renderDialogScreen } from "./dialog-box.js";
import { formatKeyHints } from "./key-hints.js";
import type { PromptScreen } from "./prompt-view.js";
import { createTuiStyle, shouldUseColor, type TuiStyle } from "./style.js";
import { wrapWords } from "./wrap-words.js";

export type MissingSecretsDialogOptions = {
  itemName: string;
  missing: string[];
  keyInput: KeyInput;
  // The screen the popup opened from; it stays visible, dimmed, around the box.
  background?: string;
  screen?: PromptScreen;
  color?: boolean;
  columns?: number;
  rows?: number;
};

export type MissingSecretsChoice = "fill" | "edit" | "cancel" | "exit";

const textWidth = 62;

// Says which secret variables an item needs, and lets the user set them now, edit the whole item, or leave.
export async function runMissingSecretsDialog(options: MissingSecretsDialogOptions): Promise<MissingSecretsChoice> {
  const screen = options.screen ?? terminalScreen;
  const style = createTuiStyle(options.color ?? shouldUseColor());
  const render = () => {
    screen.clear();
    screen.write(`${renderMissingSecretsDialog(options, style, options.columns ?? process.stdout.columns, options.rows ?? process.stdout.rows)}\n`);
  };

  render();

  while (true) {
    const keypress = await options.keyInput.readKey();

    if (isResize(keypress)) {
      render();
    } else if (keypress.ctrl === true && keypress.name === "c") {
      return "exit";
    } else if (keypress.name === "return" || keypress.sequence === "\r") {
      return "fill";
    } else if (keypress.sequence === "e") {
      return "edit";
    } else if (keypress.name === "escape" || keypress.sequence === "q") {
      return "cancel";
    }
  }
}

export function renderMissingSecretsDialog(
  options: Pick<MissingSecretsDialogOptions, "itemName" | "missing">,
  style: TuiStyle = createTuiStyle(false),
  columns = 80,
  rows?: number,
): string {
  const width = Math.min(textWidth, Math.max(16, (dialogMaxWidth(columns) ?? textWidth) - 6));
  const count = options.missing.length;
  const lines = [
    ...wrapWords(`${options.itemName} needs ${count === 1 ? "a variable that isn't" : `${count} variables that aren't`} set on this machine:`, width),
    "",
    ...options.missing.map((key) => `  ${style.title(key)}`),
    "",
    ...wrapWords("They are secrets, so the shared sable.json leaves them out on purpose: each person sets their own, and it stays on this computer.", width),
  ];

  return renderDialogScreen({
    box: renderDialogBox({ title: "Missing secret", lines, style, maxWidth: dialogMaxWidth(columns) }),
    hints: formatKeyHints([["Enter", "set now"], ["e", "edit the whole item"], ["Esc", "cancel"]], style, dialogMaxWidth(columns)),
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
