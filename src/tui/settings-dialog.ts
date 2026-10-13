import type { KeyInput } from "../input/terminal-key-input.js";
import { isResize, mapSettingsKey } from "../input/keymap.js";
import type { SettingsControl } from "../settings/settings-control.js";
import { dialogMaxWidth, renderDialogBox, renderDialogScreen } from "./dialog-box.js";
import { displayPath } from "./format.js";
import { formatKeyHints } from "./key-hints.js";
import { createTuiStyle, shouldUseColor, type TuiStyle } from "./style.js";
import { padVisibleEnd } from "./width.js";
import { wrapWords } from "./wrap-words.js";

export type SettingsDialogResult = "close" | "exit";

export type SettingsDialogOptions = {
  settings: SettingsControl;
  keyInput: KeyInput;
  // The screen the popup opened from; it stays visible, dimmed, around the box.
  background?: string;
  screen?: { clear(): void; write(contents: string): void };
  color?: boolean;
  columns?: number;
  rows?: number;
};

export type SettingsRow = {
  label: string;
  enabled: boolean;
  // Shown under the list while this row is selected.
  description: string;
};

const labelWidth = "Welcome screen".length;
// Descriptions wrap at this width, so the box is the same size whichever setting is selected.
const descriptionWidth = 48;

// A popup over the current screen, in the same box as help. ↑↓ picks a
// setting and Space switches it; each change applies and is saved at once.
export async function runSettingsDialog(options: SettingsDialogOptions): Promise<SettingsDialogResult> {
  const screen = options.screen ?? terminalScreen;
  const style = createTuiStyle(options.color ?? shouldUseColor());
  const { settings } = options;
  let selected = 0;
  const items = (): SettingsRow[] => [
    { label: "Sound", enabled: settings.sound.isEnabled(), description: "Soft tones as you move, open, start and stop, and a chime when a process ends on its own." },
    { label: "Welcome screen", enabled: settings.welcomeScreen.isEnabled(), description: "The logo animation at launch. Off goes straight to your workspaces." },
    {
      label: "Save logs",
      enabled: settings.persistLogs.isEnabled(),
      description: `Also write each item's output to a file${settings.logsDirectory === undefined ? "" : ` under ${displayPath(settings.logsDirectory)}`}, up to 2 MB each, so you can read it after Sable closes.`,
    },
  ];
  const render = () => {
    screen.clear();
    screen.write(`${renderSettingsDialog({
      items: items(),
      selected,
      background: options.background,
      columns: options.columns ?? process.stdout.columns,
      rows: options.rows ?? process.stdout.rows,
      style,
    })}\n`);
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

    const action = mapSettingsKey(keypress);

    if (action === "close") {
      return "close";
    }

    if (action === "selectNext" || action === "selectPrevious") {
      selected = (selected + (action === "selectNext" ? 1 : -1) + items().length) % items().length;
      render();
    }

    if (action === "toggle") {
      if (selected === 0) {
        const next = !settings.sound.isEnabled();

        await settings.sound.setEnabled(next);

        if (next) {
          settings.sound.play("open");
        }
      } else if (selected === 1) {
        await settings.welcomeScreen.setEnabled(!settings.welcomeScreen.isEnabled());
      } else {
        await settings.persistLogs.setEnabled(!settings.persistLogs.isEnabled());
      }

      render();
    }
  }
}

export function renderSettingsDialog(options: {
  items: SettingsRow[];
  selected: number;
  background?: string;
  columns?: number;
  rows?: number;
  style?: TuiStyle;
}): string {
  const style = options.style ?? createTuiStyle(false);
  const maxWidth = dialogMaxWidth(options.columns);
  const lines = options.items.map((row, index) => {
    const value = row.enabled ? style.running("● on") : style.muted("○ off");

    return `${index === options.selected ? ">" : " "} ${row.label.padEnd(labelWidth)}   ${value}`;
  });

  // Room for the longest description, wrapped, so the box never grows or shrinks.
  const textWidth = Math.min(descriptionWidth, Math.max(8, (maxWidth ?? Number.POSITIVE_INFINITY) - 6));
  const wrapped = options.items.map((item) => wrapWords(item.description, textWidth));
  const height = Math.max(...wrapped.map((description) => description.length));
  const description = Array.from({ length: height }, (_, index) =>
    style.muted(padVisibleEnd(wrapped[options.selected]?.[index] ?? "", textWidth)));

  return renderDialogScreen({
    box: renderDialogBox({
      title: "Settings",
      lines: [...lines, "", ...description],
      style,
      maxWidth,
    }),
    hints: formatKeyHints([["↑↓", "select"], ["Space", "toggle"], ["Esc", "close"]], style, maxWidth),
    background: options.background,
    style,
    columns: options.columns,
    rows: options.rows,
  });
}

const terminalScreen = {
  clear() {
    process.stdout.write("\x1b[2J\x1b[H");
  },
  write(contents: string) {
    process.stdout.write(contents);
  },
};
