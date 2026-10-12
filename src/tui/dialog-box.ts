import { truncateAnsi } from "./ansi-text.js";
import type { TuiStyle } from "./style.js";
import { padVisibleEnd, sliceVisible, stripAnsi, visibleLength } from "./width.js";

export type DialogBoxOptions = {
  title: string;
  lines: string[];
  style: TuiStyle;
  // Lines (by index) to center inside the box, e.g. a row of buttons.
  centered?: number[];
  // Widest the box may be. Longer lines are cut so the box never wraps on a narrow terminal.
  maxWidth?: number;
};

export type DialogScreenOptions = {
  box: string[];
  hints?: string;
  style: TuiStyle;
  columns?: number;
  rows?: number;
  // The screen the dialog opens over. It is shown dimmed around the box.
  background?: string;
};

// The most a box, or the hints under it, may use on a terminal `columns` wide, keeping the last column free.
export function dialogMaxWidth(columns: number | undefined): number | undefined {
  return columns === undefined ? undefined : Math.max(1, columns - 1);
}

// A rounded box with its title in the top border and a blank line of padding
// above and below the content: the look of every Sable popup.
export function renderDialogBox(options: DialogBoxOptions): string[] {
  const { style } = options;
  // The box is 6 columns wider than its text: two borders and two columns of padding each side.
  const textWidth = options.maxWidth === undefined ? Number.POSITIVE_INFINITY : Math.max(8, options.maxWidth - 6);
  const content = ["", ...options.lines, ""].map((line) => truncateAnsi(line, textWidth));
  const title = truncateAnsi(` ${options.title} `, textWidth - 2);
  const innerWidth = Math.max(visibleLength(title) + 2, ...content.map((line) => visibleLength(line))) + 4;
  const top = style.border(`╭─${title}${"─".repeat(Math.max(0, innerWidth - visibleLength(title) - 1))}╮`);
  const bottom = style.border(`╰${"─".repeat(innerWidth)}╯`);
  const body = content.map((line, index) => {
    const isCentered = options.centered?.includes(index - 1) === true;
    const text = isCentered ? `${" ".repeat(Math.floor((innerWidth - 4 - visibleLength(line)) / 2))}${line}` : line;

    return `${style.border("│")}  ${padVisibleEnd(text, innerWidth - 4)}  ${style.border("│")}`;
  });

  return [top, ...body, bottom];
}

// Places a box in the middle of the screen, with key hints under it. With a
// background, the rest of the screen stays visible but dimmed.
export function renderDialogScreen(options: DialogScreenOptions): string {
  const { box, style } = options;
  const columns = options.columns ?? 80;
  const boxWidth = Math.max(...box.map((line) => visibleLength(line)));
  const left = Math.max(0, Math.floor((columns - boxWidth) / 2));
  const backgroundLines = options.background === undefined ? [] : stripAnsi(options.background).replace(/\n$/, "").split("\n");
  const available = options.rows === undefined ? undefined : Math.max(1, options.rows - 1);
  // Drop the spacer above the hints when the terminal is too short for it.
  const spacer = available === undefined || box.length + 2 <= available ? [""] : [];
  const overlay = [...box, ...(options.hints === undefined ? [] : [...spacer, options.hints])];
  const height = available ?? Math.max(backgroundLines.length, overlay.length + 2);
  const top = Math.max(0, Math.min(Math.floor((height - overlay.length) / 2), height - overlay.length));
  const lines: string[] = [];

  for (let row = 0; row < Math.max(height, top + overlay.length); row += 1) {
    const background = backgroundLines[row] ?? "";
    const overlayLine = overlay[row - top];

    if (overlayLine === undefined) {
      lines.push(background === "" ? "" : style.muted(background));
      continue;
    }

    // Only the box sits over the background; the hint rows under it are clear.
    if (row - top >= box.length) {
      lines.push(overlayLine === "" ? "" : `${" ".repeat(left)}${overlayLine}`);
      continue;
    }

    const before = padVisibleEnd(sliceVisible(background, 0, left), left);
    const after = sliceVisible(background, left + boxWidth, Math.max(0, columns - 1 - left - boxWidth));

    lines.push(`${style.muted(before)}${overlayLine}${after === "" ? "" : style.muted(after)}`.trimEnd());
  }

  while (lines.length > 0 && lines.at(-1) === "") {
    lines.pop();
  }

  return lines.join("\n");
}
