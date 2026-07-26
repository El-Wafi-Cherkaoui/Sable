import type { Keypress } from "../input/keymap.js";
import type { KeyInput } from "../input/terminal-key-input.js";

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
  defaultValue?: string;
  validate?: (value: string) => boolean | string;
};

export type SelectPromptOptions<T extends string> = {
  title: string;
  message: string;
  keyInput: KeyInput;
  screen?: PromptScreen;
  choices: Array<{ label: string; value: T }>;
};

export type ConfirmPromptOptions = {
  title: string;
  message: string;
  keyInput: KeyInput;
  screen?: PromptScreen;
  defaultValue?: boolean;
};

export async function runTextPrompt(
  options: TextPromptOptions,
): Promise<PromptResult<string>> {
  const screen = options.screen ?? terminalScreen;
  let value = options.defaultValue ?? "";
  let error: string | undefined;

  renderFrame(screen, renderTextPrompt(options, value, error));

  while (true) {
    const keypress = await options.keyInput.readKey();

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
        renderFrame(screen, renderTextPrompt(options, value, error));
        continue;
      }

      return { type: "submit", value };
    }

    if (keypress.name === "backspace") {
      value = value.slice(0, -1);
      error = undefined;
      renderFrame(screen, renderTextPrompt(options, value, error));
      continue;
    }

    if (keypress.sequence !== undefined && isPrintable(keypress.sequence)) {
      value += keypress.sequence;
      error = undefined;
      renderFrame(screen, renderTextPrompt(options, value, error));
    }
  }
}

export async function runSelectPrompt<T extends string>(
  options: SelectPromptOptions<T>,
): Promise<PromptResult<T>> {
  const screen = options.screen ?? terminalScreen;
  let selectedIndex = 0;

  renderFrame(screen, renderSelectPrompt(options, selectedIndex));

  while (true) {
    const keypress = await options.keyInput.readKey();

    if (isCtrlC(keypress)) {
      return { type: "exit" };
    }

    if (keypress.name === "escape") {
      return { type: "back" };
    }

    if (keypress.name === "return" || keypress.sequence === "\r") {
      return { type: "submit", value: options.choices[selectedIndex].value };
    }

    if (keypress.name === "down" || keypress.sequence === "j") {
      selectedIndex = (selectedIndex + 1) % options.choices.length;
      renderFrame(screen, renderSelectPrompt(options, selectedIndex));
      continue;
    }

    if (keypress.name === "up" || keypress.sequence === "k") {
      selectedIndex = (selectedIndex - 1 + options.choices.length) % options.choices.length;
      renderFrame(screen, renderSelectPrompt(options, selectedIndex));
    }
  }
}

export async function runConfirmPrompt(
  options: ConfirmPromptOptions,
): Promise<PromptResult<boolean>> {
  const screen = options.screen ?? terminalScreen;
  const defaultValue = options.defaultValue ?? false;

  renderFrame(screen, renderConfirmPrompt(options, defaultValue));

  while (true) {
    const keypress = await options.keyInput.readKey();

    if (isCtrlC(keypress)) {
      return { type: "exit" };
    }

    if (keypress.name === "escape") {
      return { type: "back" };
    }

    if (keypress.name === "return" || keypress.sequence === "\r") {
      return { type: "submit", value: defaultValue };
    }

    if (keypress.sequence === "y" || keypress.sequence === "Y") {
      return { type: "submit", value: true };
    }

    if (keypress.sequence === "n" || keypress.sequence === "N") {
      return { type: "submit", value: false };
    }
  }
}

function renderTextPrompt(
  options: TextPromptOptions,
  value: string,
  error: string | undefined,
): string {
  return [
    options.title,
    "",
    options.message,
    `> ${value}`,
    ...(error === undefined ? [] : ["", error]),
    "",
    "Esc back  Enter save  Ctrl+C quit",
  ].join("\n");
}

function renderSelectPrompt<T extends string>(
  options: SelectPromptOptions<T>,
  selectedIndex: number,
): string {
  return [
    options.title,
    "",
    options.message,
    "",
    ...options.choices.map((choice, index) =>
      `${index === selectedIndex ? ">" : " "} ${choice.label}`,
    ),
    "",
    "j/k move  Esc back  Enter select  Ctrl+C quit",
  ].join("\n");
}

function renderConfirmPrompt(
  options: ConfirmPromptOptions,
  defaultValue: boolean,
): string {
  return [
    options.title,
    "",
    options.message,
    `> ${defaultValue ? "yes" : "no"}`,
    "",
    "y yes  n no  Enter default  Esc back  Ctrl+C quit",
  ].join("\n");
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
