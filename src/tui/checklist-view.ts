import { isResize } from "../input/keymap.js";
import type { KeyInput } from "../input/terminal-key-input.js";
import { formatKeyHints } from "./key-hints.js";
import type { PromptScreen } from "./prompt-view.js";
import { createTuiStyle, shouldUseColor, type TuiStyle } from "./style.js";
import { padVisibleEnd, truncateVisible } from "./width.js";

export type ChecklistItem = {
  label: string;
  detail: string;
  note?: string;
  selected: boolean;
};

export type RunChecklistOptions = {
  title: string;
  subtitle?: string;
  question: string;
  explanation?: string;
  items: ChecklistItem[];
  keyInput: KeyInput;
  screen?: PromptScreen;
  color?: boolean;
  columns?: number;
};

export type ChecklistResult =
  | { type: "submit"; selected: boolean[] }
  | { type: "back" }
  | { type: "exit" };

export async function runChecklist(options: RunChecklistOptions): Promise<ChecklistResult> {
  const screen = options.screen ?? terminalScreen;
  const color = options.color ?? shouldUseColor();
  const style = createTuiStyle(color);
  const selected = options.items.map((item) => item.selected);
  let focus = 0;
  const render = () => {
    screen.clear();
    screen.write(`${renderChecklist(options, selected, focus, style, color, options.columns ?? process.stdout.columns ?? 80)}\n`);
  };

  render();

  while (true) {
    const keypress = await options.keyInput.readKey();

    if (isResize(keypress)) {
      render();
      continue;
    }

    if (keypress.ctrl === true && keypress.name === "c") {
      return { type: "exit" };
    }

    if (keypress.name === "escape") {
      return { type: "back" };
    }

    if (keypress.name === "return" || keypress.sequence === "\r") {
      return { type: "submit", selected };
    }

    if (keypress.name === "up" || keypress.sequence === "k") {
      focus = Math.max(0, focus - 1);
    } else if (keypress.name === "down" || keypress.sequence === "j") {
      focus = Math.min(options.items.length - 1, focus + 1);
    } else if (keypress.name === "space" || keypress.sequence === " ") {
      selected[focus] = !selected[focus];
    } else {
      continue;
    }

    render();
  }
}

export function renderChecklist(
  options: Pick<RunChecklistOptions, "title" | "subtitle" | "question" | "explanation" | "items">,
  selected: boolean[],
  focus: number,
  style: TuiStyle = createTuiStyle(false),
  color = false,
  columns = 80,
): string {
  const labelWidth = Math.max(...options.items.map((item) => item.label.length));
  const count = selected.filter(Boolean).length;
  const lines = [
    `${style.title(options.title)}${options.subtitle === undefined ? "" : style.muted(` · ${options.subtitle}`)}`,
    "",
    options.question,
    ...(options.explanation === undefined ? [] : [style.muted(options.explanation)]),
    "",
  ];

  for (const [index, item] of options.items.entries()) {
    const note = item.note === undefined ? "" : `  ${style.muted(item.note)}`;
    const line = truncateVisible(
      `${index === focus ? "> " : "  "}[${selected[index] ? "x" : " "}] ${padVisibleEnd(item.label, labelWidth)}  ${style.muted(item.detail)}${note}`,
      columns - 1,
    );

    lines.push(index === focus && color ? style.selected(padVisibleEnd(line, columns - 1)) : line);
  }

  lines.push("", formatKeyHints([
    ["↑↓", "move"],
    ["Space", "toggle"],
    ["Enter", count === 0 ? "skip" : `add ${count}`],
    ["Esc", "skip"],
  ], style, columns - 1));

  return lines.join("\n");
}

const terminalScreen: PromptScreen = {
  clear() {
    process.stdout.write("\x1b[2J\x1b[H");
  },
  write(contents) {
    process.stdout.write(contents);
  },
};
