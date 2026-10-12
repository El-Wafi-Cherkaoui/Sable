/* eslint-disable no-control-regex */

// One pass over every escape sequence, so a kept color code is never re-matched:
// string sequences (OSC, DCS, ...) ended by BEL or ESC \ (unterminated ones run to the end
// of the line), CSI sequences, then any other ESC sequence.
const escapeSequence =
  /\x1b(?:[\]PX^_][^\x07\x1b]*(?:\x07|\x1b\\|$)|\[([0-?]*)([ -/]*)([@-~])?|[ -/]*[0-~]?)/g;
const controlCharacters = /[\x00-\x08\x0b-\x1a\x1c-\x1f\x7f-\x9f]/g;

// Cleans one line of child output for display: keeps SGR colors, drops every other
// escape sequence and control character, and keeps only what a "\r" progress bar
// finally left on the line.
export function sanitizeLogLine(line: string): string {
  return stripUnsafeSequences(lastCarriageReturnSegment(line));
}

// A lone "\r" returns the cursor to column 0, so the last non-empty segment wins.
export function lastCarriageReturnSegment(line: string): string {
  if (!line.includes("\r")) {
    return line;
  }

  const segments = line.split("\r");

  for (let index = segments.length - 1; index >= 0; index -= 1) {
    if (segments[index] !== "") {
      return segments[index] ?? "";
    }
  }

  return "";
}

function stripUnsafeSequences(line: string): string {
  return line
    .replace(escapeSequence, (sequence, params?: string, intermediates?: string, final?: string) =>
      final === "m" && intermediates === "" && /^[0-9;:]*$/.test(params ?? "") ? sequence : "",
    )
    .replace(controlCharacters, "");
}
