import type { KeyInput } from "../input/terminal-key-input.js";
import { mapSettingsKey } from "../input/keymap.js";
import type { SoundControl } from "../sound/sound-control.js";
import { dialogMaxWidth, renderDialogBox, renderDialogScreen } from "./dialog-box.js";
import { formatKeyHints } from "./key-hints.js";
import { createTuiStyle, shouldUseColor, type TuiStyle } from "./style.js";

export type SettingsDialogResult = "close" | "exit";

export type SettingsDialogOptions = {
  sound: SoundControl;
  keyInput: KeyInput;
  // The screen the popup opened from; it stays visible, dimmed, around the box.
  background?: string;
  screen?: { clear(): void; write(contents: string): void };
  color?: boolean;
  columns?: number;
  rows?: number;
};

// A popup over the current screen, in the same box as help. Today it holds
// one setting, so the single row is always selected.
export async function runSettingsDialog(options: SettingsDialogOptions): Promise<SettingsDialogResult> {
  const screen = options.screen ?? terminalScreen;
  const style = createTuiStyle(options.color ?? shouldUseColor());
  const render = () => {
    screen.clear();
    screen.write(`${renderSettingsDialog({
      soundEnabled: options.sound.isEnabled(),
      background: options.background,
      columns: options.columns ?? process.stdout.columns,
      rows: options.rows ?? process.stdout.rows,
      style,
    })}\n`);
  };

  render();

  while (true) {
    const keypress = await options.keyInput.readKey();

    if (keypress.ctrl === true && keypress.name === "c") {
      return "exit";
    }

    const action = mapSettingsKey(keypress);

    if (action === "close") {
      return "close";
    }

    if (action === "toggle") {
      const next = !options.sound.isEnabled();

      await options.sound.setEnabled(next);

      if (next) {
        options.sound.play("open");
      }

      render();
    }
  }
}

export function renderSettingsDialog(options: {
  soundEnabled: boolean;
  background?: string;
  columns?: number;
  rows?: number;
  style?: TuiStyle;
}): string {
  const style = options.style ?? createTuiStyle(false);
  const value = options.soundEnabled ? style.running("● on") : style.muted("○ off");
  const maxWidth = dialogMaxWidth(options.columns);

  return renderDialogScreen({
    box: renderDialogBox({
      title: "Settings",
      lines: [
        `> Sound   ${value}`,
        "",
        style.muted("Soft tones as you move, open, start and stop."),
        style.muted("A chime when a process ends on its own."),
      ],
      style,
      maxWidth,
    }),
    hints: formatKeyHints([["Space", "toggle"], ["Esc", "close"]], style, maxWidth),
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
