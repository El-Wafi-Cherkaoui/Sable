import { isResize } from "../input/keymap.js";
import type { KeyInput } from "../input/terminal-key-input.js";
import { formatKeyHints } from "./key-hints.js";
import { appendAnchoredFooter, clipLines } from "./layout.js";
import type { PromptScreen } from "./prompt-view.js";
import { createTuiStyle, shouldUseColor, type TuiStyle } from "./style.js";
import { sliceVisible, visibleLength } from "./width.js";

export type ReviewLine = { text: string; tone?: "plain" | "muted" | "heading" | "added" | "removed" };

export type ReviewOptions = {
  title: string;
  intro?: string[];
  lines: ReviewLine[];
  confirmLabel: string;
  cancelLabel?: string;
  keyInput: KeyInput;
  screen?: PromptScreen;
  color?: boolean;
  columns?: number;
  rows?: number;
};

export type ReviewResult = "confirm" | "cancel" | "exit";

// A full-screen list to read before agreeing to something, like the commands a file would run.
// Long lines are wrapped, never cut off: what is hidden at the end of a command can still matter.
export async function runReview(options: ReviewOptions): Promise<ReviewResult> {
  const screen = options.screen ?? terminalScreen;
  const style = createTuiStyle(options.color ?? shouldUseColor());
  let offset = 0;
  const frame = () => renderReview(options, offset, style, options.columns ?? process.stdout.columns, options.rows ?? process.stdout.rows);
  const draw = () => {
    const rendered = frame();

    offset = rendered.offset;
    screen.clear();
    screen.write(`${rendered.text}\n`);

    return rendered;
  };

  let current = draw();

  while (true) {
    const keypress = await options.keyInput.readKey();

    if (isResize(keypress)) {
      current = draw();
      continue;
    }

    if (keypress.ctrl === true && keypress.name === "c") {
      return "exit";
    }

    if (keypress.name === "escape" || keypress.sequence === "q") {
      return "cancel";
    }

    if (keypress.name === "return" || keypress.sequence === "\r") {
      return "confirm";
    }

    const step = keypress.name === "down" ? 1
      : keypress.name === "up" ? -1
        : keypress.name === "pagedown" || keypress.sequence === " " ? current.pageSize
          : keypress.name === "pageup" ? -current.pageSize
            : keypress.name === "home" ? -Infinity
              : keypress.name === "end" ? Infinity
                : 0;

    if (step !== 0) {
      offset = Math.max(0, Math.min(offset + step, current.maxOffset));
      current = draw();
    }
  }
}

export type RenderedReview = { text: string; offset: number; maxOffset: number; pageSize: number };

export function renderReview(
  options: Pick<ReviewOptions, "title" | "intro" | "lines" | "confirmLabel" | "cancelLabel">,
  offset: number,
  style: TuiStyle = createTuiStyle(false),
  columns = 80,
  rows?: number,
): RenderedReview {
  const width = Math.max(20, columns - 1);
  const header = [style.title(options.title), ...(options.intro ?? []).flatMap((line) => wrap(line, width)), ""];
  const body = options.lines.flatMap((line) => wrap(line.text, width).map((text) => paint(text, line.tone, style)));
  const footer = ["", formatKeyHints(
    [["Enter", options.confirmLabel], ["↑↓", "scroll"], ["Esc", options.cancelLabel ?? "not now"]],
    style,
    width,
  )];
  const indicatorLines = 1;
  const available = rows === undefined || rows <= 0 ? body.length : Math.max(3, rows - 1 - header.length - footer.length - indicatorLines);
  const pageSize = Math.max(1, available - 1);
  const maxOffset = Math.max(0, body.length - available);
  const start = Math.min(Math.max(0, offset), maxOffset);
  const shown = body.slice(start, start + available);
  const above = start;
  const below = Math.max(0, body.length - start - shown.length);
  const indicator = above === 0 && below === 0
    ? ""
    : style.muted([above > 0 ? `↑ ${above} more above` : "", below > 0 ? `↓ ${below} more below` : ""].filter((part) => part !== "").join(" · "));
  const lines = [...header, ...shown, indicator];

  appendAnchoredFooter(lines, footer, rows);

  return { text: clipLines(lines.join("\n"), columns), offset: start, maxOffset, pageSize };
}

function paint(text: string, tone: ReviewLine["tone"], style: TuiStyle): string {
  switch (tone) {
    case "heading":
      return style.title(text);
    case "muted":
      return style.muted(text);
    case "added":
      return style.running(text);
    case "removed":
      return style.failed(text);
    default:
      return text;
  }
}

// Splits a line at the terminal width, indenting the continuation lines a little further.
function wrap(text: string, width: number): string[] {
  if (visibleLength(text) <= width) {
    return [text];
  }

  const indent = " ".repeat((text.length - text.trimStart().length) + 2);
  const lines: string[] = [];
  let column = 0;
  let first = true;

  while (column < visibleLength(text)) {
    const room = first ? width : Math.max(8, width - indent.length);
    const piece = sliceVisible(text, column, room);

    if (piece === "") {
      break;
    }

    lines.push(first ? piece : `${indent}${piece}`);
    column += visibleLength(piece);
    first = false;
  }

  return lines;
}

const terminalScreen: PromptScreen = {
  clear() {
    process.stdout.write("\x1b[2J\x1b[H");
  },
  write(contents) {
    process.stdout.write(contents);
  },
};
