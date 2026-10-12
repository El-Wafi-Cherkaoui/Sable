import { isResize } from "../input/keymap.js";
import type { KeyInput } from "../input/terminal-key-input.js";
import { dialogMaxWidth, renderDialogBox, renderDialogScreen } from "./dialog-box.js";
import { formatKeyHints } from "./key-hints.js";
import type { PromptScreen } from "./prompt-view.js";
import { createTuiStyle, shouldUseColor, type TuiStyle } from "./style.js";

export type UpdateDialogChoice = "ok" | "update" | "exit";

export type UpdateDialogOptions = {
  latestVersion: string;
  currentVersion: string;
  installCommand: string;
  keyInput: KeyInput;
  screen?: PromptScreen;
  color?: boolean;
  columns?: number;
  rows?: number;
};

const buttons = [
  { choice: "ok" as const, label: "OK" },
  { choice: "update" as const, label: "Update now" },
];

// A small centered popup shown once at launch when a newer Sable is on npm.
// Update now is selected by default; Esc or q means "later".
export async function runUpdateDialog(options: UpdateDialogOptions): Promise<UpdateDialogChoice> {
  const screen = options.screen ?? terminalScreen;
  const color = options.color ?? shouldUseColor();
  const style = createTuiStyle(color);
  let selected = 1;
  const render = () => {
    screen.clear();
    screen.write(`${renderUpdateDialog(options, selected, style, options.columns ?? process.stdout.columns, options.rows ?? process.stdout.rows)}\n`);
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

    if (keypress.name === "escape" || keypress.sequence === "q") {
      return "ok";
    }

    if (keypress.name === "return" || keypress.sequence === "\r") {
      return buttons[selected]!.choice;
    }

    if (keypress.name === "left" || keypress.name === "right" || keypress.name === "tab" || keypress.sequence === "h" || keypress.sequence === "l") {
      selected = selected === 0 ? 1 : 0;
      render();
    }
  }
}

export function renderUpdateDialog(
  options: Pick<UpdateDialogOptions, "latestVersion" | "currentVersion" | "installCommand">,
  selected: number,
  style: TuiStyle = createTuiStyle(false),
  columns = 80,
  rows?: number,
): string {
  const buttonRow = buttons
    .map((button, index) => index === selected ? style.key(button.label) : style.muted(` ${button.label} `))
    .join("    ");
  const box = renderDialogBox({
    title: "Update available",
    lines: [
      `Sable ${style.title(options.latestVersion)} is available. You have ${options.currentVersion}.`,
      "",
      style.muted("Update now closes Sable and runs:"),
      options.installCommand,
      "",
      buttonRow,
    ],
    centered: [5],
    style,
    maxWidth: dialogMaxWidth(columns),
  });

  return renderDialogScreen({
    box,
    hints: formatKeyHints([["←→", "choose"], ["Enter", "select"], ["Esc", "later"]], style, dialogMaxWidth(columns)),
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
