import stringWidth from "string-width";

// Text helpers for log lines that carry SGR color codes (ESC[...m), which is all the
// process manager lets through. Every result is self-contained: color that was active
// when a piece starts is re-applied, and anything still active at its end is reset,
// so a cut never leaves half a code behind or lets color bleed into the next row.

const sgrPattern = /\x1b\[[0-9;:]*m/y; // eslint-disable-line no-control-regex
const reset = "\x1b[0m";

type Piece = { sgr: string } | { text: string; width: number };

function* pieces(line: string): Generator<Piece> {
  let index = 0;

  while (index < line.length) {
    sgrPattern.lastIndex = index;
    const match = sgrPattern.exec(line);

    if (match !== null) {
      yield { sgr: match[0] };
      index += match[0].length;
      continue;
    }

    const text = String.fromCodePoint(line.codePointAt(index) ?? 0);

    yield { text, width: stringWidth(text) };
    index += text.length;
  }
}

function applySgr(active: string[], sgr: string): string[] {
  const params = sgr.slice(2, -1);

  return params === "" || /^0*(?:;0*)*$/.test(params) ? [] : [...active, sgr];
}

// The part of a line between two screen columns, keeping colors.
export function sliceAnsi(line: string, startColumn: number, maxWidth = Number.POSITIVE_INFINITY): string {
  let active: string[] = [];
  let output = "";
  let column = 0;
  let outputWidth = 0;
  let started = false;

  for (const piece of pieces(line)) {
    if ("sgr" in piece) {
      active = applySgr(active, piece.sgr);

      if (started) {
        output += piece.sgr;
      }

      continue;
    }

    const next = column + piece.width;

    if (next <= startColumn) {
      column = next;
      continue;
    }

    if (outputWidth + piece.width > maxWidth) {
      break;
    }

    if (!started) {
      started = true;
      output += active.join("");
    }

    output += piece.text;
    outputWidth += piece.width;
    column = next;
  }

  return active.length > 0 && started ? `${output}${reset}` : output;
}

// Cut to `maxWidth` columns, ending in "..." when something was cut.
export function truncateAnsi(line: string, maxWidth: number): string {
  if (ansiWidth(line) <= maxWidth) {
    return line;
  }

  if (maxWidth <= 3) {
    return sliceAnsi(line, 0, maxWidth);
  }

  return `${sliceAnsi(line, 0, maxWidth - 3)}...`;
}

// Split into rows of at most `width` columns. Every row stands on its own.
export function wrapAnsi(line: string, width: number): string[] {
  const rows: string[] = [];
  let active: string[] = [];
  let row = "";
  let rowWidth = 0;

  const finishRow = () => {
    rows.push(active.length > 0 ? `${row}${reset}` : row);
    row = active.join("");
    rowWidth = 0;
  };

  for (const piece of pieces(line)) {
    if ("sgr" in piece) {
      active = applySgr(active, piece.sgr);
      row += piece.sgr;
      continue;
    }

    if (rowWidth > 0 && rowWidth + piece.width > width) {
      finishRow();
    }

    row += piece.text;
    rowWidth += piece.width;
  }

  if (rowWidth > 0 || rows.length === 0) {
    rows.push(active.length > 0 ? `${row}${reset}` : row);
  }

  return rows;
}

// Reverse-video every case-insensitive match of `query`, measured on the visible text
// so color codes never hide or fake a match.
export function highlightAnsi(line: string, query: string): string {
  const needle = query.toLowerCase();

  if (needle === "") {
    return line;
  }

  const parts = [...pieces(line)];
  const plain = parts.map((piece) => ("text" in piece ? piece.text : "")).join("");
  const lowered = plain.toLowerCase();
  const marked = new Array<boolean>(plain.length).fill(false);

  for (let found = lowered.indexOf(needle); found !== -1; found = lowered.indexOf(needle, found + needle.length)) {
    marked.fill(true, found, found + needle.length);
  }

  let output = "";
  let position = 0;
  let open = false;

  for (const piece of parts) {
    if ("sgr" in piece) {
      output += piece.sgr;
      continue;
    }

    const isMarked = marked[position] === true;

    if (isMarked !== open) {
      output += isMarked ? "\x1b[7m" : "\x1b[27m";
      open = isMarked;
    }

    output += piece.text;
    position += piece.text.length;
  }

  return open ? `${output}\x1b[27m` : output;
}

function ansiWidth(line: string): number {
  let width = 0;

  for (const piece of pieces(line)) {
    if ("text" in piece) {
      width += piece.width;
    }
  }

  return width;
}
