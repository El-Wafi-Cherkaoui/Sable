import type { KeyInput } from "../input/terminal-key-input.js";
import { formatKeyHints } from "./key-hints.js";
import type { PromptScreen } from "./prompt-view.js";
import { createTuiStyle, shouldUseColor, type TuiStyle } from "./style.js";
import { padVisibleEnd, visibleLength } from "./width.js";

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
  const content = [
    "",
    `Sable ${style.title(options.latestVersion)} is available. You have ${options.currentVersion}.`,
    "",
    style.muted("Update now closes Sable and runs:"),
    options.installCommand,
    "",
    buttonRow,
    "",
  ];
  const innerWidth = Math.max(...content.map((line) => visibleLength(line))) + 4;
  const title = " Update available ";
  const top = style.border(`╭─${title}${"─".repeat(Math.max(0, innerWidth - title.length - 1))}╮`);
  const bottom = style.border(`╰${"─".repeat(innerWidth)}╯`);
  const body = content.map((line, index) => {
    // Center the buttons; everything else is left-aligned with a two-space margin.
    const text = index === 6 ? `${" ".repeat(Math.floor((innerWidth - 4 - visibleLength(line)) / 2))}${line}` : line;

    return `${style.border("│")}  ${padVisibleEnd(text, innerWidth - 4)}  ${style.border("│")}`;
  });
  const box = [top, ...body, bottom];
  const left = " ".repeat(Math.max(0, Math.floor((columns - visibleLength(box[0]!)) / 2)));
  const above = rows === undefined ? 1 : Math.max(1, Math.floor((rows - box.length - 2) / 2));

  return [
    ...Array.from({ length: above }, () => ""),
    ...box.map((line) => `${left}${line}`),
    "",
    `${left}${formatKeyHints([["←→", "choose"], ["Enter", "select"], ["Esc", "later"]], style)}`,
  ].join("\n");
}

const terminalScreen: PromptScreen = {
  clear() {
    process.stdout.write("\x1b[2J\x1b[H");
  },
  write(contents) {
    process.stdout.write(contents);
  },
};
