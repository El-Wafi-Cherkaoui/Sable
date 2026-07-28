const terminalScrollSafetyMargin = 1;

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
