import { truncateAnsi } from "./ansi-text.js";

const terminalScrollSafetyMargin = 1;

// Keeps every line of a frame inside the terminal: a line that reaches the last column
// would wrap and push the rest of the screen down. Colors survive the cut.
export function clipLines(text: string, columns: number | undefined): string {
  if (columns === undefined) {
    return text;
  }

  const width = Math.max(1, columns - 1);

  return text.split("\n").map((line) => truncateAnsi(line, width)).join("\n");
}

export function appendAnchoredFooter(
  lines: string[],
  footerLines: string[],
  rows: number | undefined,
): void {
  const safeRows = resolveSafeRows(rows);

  if (safeRows !== undefined) {
    const targetContentLineCount = Math.max(0, safeRows - footerLines.length);

    while (lines.length < targetContentLineCount) {
      lines.push("");
    }
  }

  lines.push(...footerLines);
}

function resolveSafeRows(rows: number | undefined): number | undefined {
  if (rows === undefined || rows <= terminalScrollSafetyMargin) {
    return undefined;
  }

  return rows - terminalScrollSafetyMargin;
}
