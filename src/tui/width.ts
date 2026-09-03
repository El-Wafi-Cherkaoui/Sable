import stringWidth from "string-width";

export function visibleLength(value: string): number {
  return stringWidth(stripAnsi(value));
}

export function padVisibleEnd(value: string, width: number): string {
  return `${value}${" ".repeat(Math.max(0, width - visibleLength(value)))}`;
}

export function truncateVisible(value: string, maxLength: number): string {
  if (visibleLength(value) <= maxLength) {
    return value;
  }

  if (maxLength <= 3) {
    return sliceVisibleRange(stripAnsi(value), 0, maxLength);
  }

  return `${sliceVisibleRange(stripAnsi(value), 0, maxLength - 3)}...`;
}

export function sliceVisibleStart(value: string, startColumn: number): string {
  return sliceVisibleRange(stripAnsi(value), Math.max(0, startColumn));
}
export function stripAnsi(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}

function sliceVisibleRange(value: string, startColumn: number, maxLength = Number.POSITIVE_INFINITY): string {
  let output = "";
  let width = 0;
  let outputWidth = 0;

  for (const character of value) {
    const characterWidth = stringWidth(character);
    const nextWidth = width + characterWidth;

    if (nextWidth <= startColumn) {
      width = nextWidth;
      continue;
    }

    if (outputWidth + characterWidth > maxLength) {
      break;
    }

    output += character;
    outputWidth += characterWidth;
    width = nextWidth;
  }

  return output;
}