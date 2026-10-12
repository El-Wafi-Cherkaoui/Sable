import { isResize, type Keypress } from "../input/keymap.js";
import type { KeyInput } from "../input/terminal-key-input.js";
import { formatKeyHints } from "./key-hints.js";
import { createTuiStyle, shouldUseColor, type TuiStyle } from "./style.js";
import { visibleLength } from "./width.js";

export type PromptResult<T> =
  | { type: "submit"; value: T }
  | { type: "back" }
  | { type: "exit" };

export type PromptScreen = {
  clear(): void;
  write(contents: string): void;
};

export type TextPromptOptions = {
  title: string;
  message: string;
  keyInput: KeyInput;
  screen?: PromptScreen;
  color?: boolean;
  style?: TuiStyle;
  defaultValue?: string;
  validate?: (value: string) => boolean | string;
};

export async function runTextPrompt(
  options: TextPromptOptions,
): Promise<PromptResult<string>> {
  const screen = options.screen ?? terminalScreen;
  let value = options.defaultValue ?? "";
  let cursorIndex = value.length;
  let error: string | undefined;

  renderFrame(screen, renderTextPrompt(options, value, cursorIndex, error));

  while (true) {
    const keypress = await options.keyInput.readKey();

    if (isResize(keypress)) {
      renderFrame(screen, renderTextPrompt(options, value, cursorIndex, error));
      continue;
    }

    if (isCtrlC(keypress)) {
      return { type: "exit" };
    }

    if (keypress.name === "escape") {
      return { type: "back" };
    }

    if (keypress.name === "return" || keypress.sequence === "\r") {
      const validationResult = options.validate?.(value);

      if (validationResult !== undefined && validationResult !== true) {
        error = validationResult === false ? "Invalid value." : validationResult;
        renderFrame(screen, renderTextPrompt(options, value, cursorIndex, error));
        continue;
      }

      return { type: "submit", value };
    }

    if (keypress.name === "left") {
      cursorIndex = Math.max(0, cursorIndex - 1);
      renderFrame(screen, renderTextPrompt(options, value, cursorIndex, error));
      continue;
    }

    if (keypress.name === "right") {
      cursorIndex = Math.min(value.length, cursorIndex + 1);
      renderFrame(screen, renderTextPrompt(options, value, cursorIndex, error));
      continue;
    }

    if (keypress.name === "home") {
      cursorIndex = 0;
      renderFrame(screen, renderTextPrompt(options, value, cursorIndex, error));
      continue;
    }

    if (keypress.name === "end") {
      cursorIndex = value.length;
      renderFrame(screen, renderTextPrompt(options, value, cursorIndex, error));
      continue;
    }

    if (keypress.name === "backspace") {
      if (cursorIndex > 0) {
        value = `${value.slice(0, cursorIndex - 1)}${value.slice(cursorIndex)}`;
        cursorIndex -= 1;
      }
      error = undefined;
      renderFrame(screen, renderTextPrompt(options, value, cursorIndex, error));
      continue;
    }

    if (keypress.name === "delete") {
      if (cursorIndex < value.length) {
        value = `${value.slice(0, cursorIndex)}${value.slice(cursorIndex + 1)}`;
      }
      error = undefined;
      renderFrame(screen, renderTextPrompt(options, value, cursorIndex, error));
      continue;
    }

    if (keypress.sequence !== undefined && isPrintable(keypress.sequence)) {
      value = `${value.slice(0, cursorIndex)}${keypress.sequence}${value.slice(cursorIndex)}`;
      cursorIndex += keypress.sequence.length;
      error = undefined;
      renderFrame(screen, renderTextPrompt(options, value, cursorIndex, error));
    }
  }
}

function renderTextPrompt(
  options: TextPromptOptions,
  value: string,
  cursorIndex: number,
  error: string | undefined,
): string {
  const style = options.style ?? createTuiStyle(options.color ?? shouldUseColor());

  return [
    options.title,
    "",
    options.message,
    "",
    ...renderInputValue(value, style, cursorIndex),
    ...(error === undefined ? [] : ["", error]),
    "",
    formatKeyHints([["Enter", "save"], ["Esc", "back"], ["←→", "edit"]], style),
  ].join("\n");
}

function renderInputValue(value: string, style: TuiStyle, cursorIndex?: number): string[] {
  const underlineWidth = Math.max(1, visibleLength(value));
  const lines = [
    `  ${value}`,
    `  ${style.muted("─".repeat(underlineWidth))}`,
  ];

  if (cursorIndex !== undefined) {
    const cursorOffset = visibleLength(value.slice(0, cursorIndex));
    lines.push(`  ${" ".repeat(cursorOffset)}^`);
  }

  return lines;
}

function isCtrlC(keypress: Keypress): boolean {
  return keypress.ctrl === true && keypress.name === "c";
}

function isPrintable(sequence: string): boolean {
  return sequence.length === 1 && sequence >= " " && sequence !== "\x7f";
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
