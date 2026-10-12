import { sableLogoAnsi } from "../generated/sable-logo-ansi.js";

// The launch logo is made of braille characters, and each one is 2x4 separate
// dots (the bits of its code point). That lets the logo build up dot by dot.

type Cell = {
  // The color codes in front of the character.
  prefix: string;
  char: string;
  // Which of the character's eight dots are lit in the finished logo.
  mask: number;
};
type ParsedLine = { cells: Cell[]; suffix: string };
type Dot = { row: number; column: number; bit: number };

const brailleBase = 0x2800;
const glowPrefix = "\x1b[97m\x1b[40m";
const cellPattern = /((?:\x1b\[[0-9;]*m)*)([\u2800-\u28ff ])/g; // eslint-disable-line no-control-regex

function parseLine(line: string): ParsedLine {
  const cells: Cell[] = [];
  let end = 0;

  for (const match of line.matchAll(cellPattern)) {
    const char = match[2]!;

    cells.push({ prefix: match[1]!, char, mask: char === " " ? 0 : char.codePointAt(0)! - brailleBase });
    end = match.index + match[0].length;
  }

  return { cells, suffix: line.slice(end) };
}

const parsed = sableLogoAnsi.map(parseLine);

// Every lit dot in a fixed random order, so the same dots appear first on every
// launch (and in tests).
const dots: Dot[] = shuffle(
  parsed.flatMap((line, row) => line.cells.flatMap((cell, column) =>
    Array.from({ length: 8 }, (_, bit) => ({ row, column, bit })).filter((dot) => (cell.mask & (1 << dot.bit)) !== 0))),
);

// Where each dot sits in the reveal order: dotRank[row][column][bit].
const dotRank = parsed.map((line) => line.cells.map(() => new Array<number>(8).fill(Number.POSITIVE_INFINITY)));

dots.forEach((dot, rank) => {
  dotRank[dot.row]![dot.column]![dot.bit] = rank;
});

export const logoDotCount = dots.length;

// The logo with the first `revealed` dots lit. The newest `glow` dots, and the
// cells holding them, are drawn bright white; the rest keep their own shade.
// With every dot revealed the result is exactly the finished logo.
export function renderRevealedLogo(revealed: number, glow = 0): string[] {
  return parsed.map((line, row) => {
    const cells = line.cells.map((cell, column) => {
      if (cell.mask === 0) {
        return `${cell.prefix}${cell.char}`;
      }

      let shown = 0;
      let glowing = false;

      for (let bit = 0; bit < 8; bit += 1) {
        const rank = dotRank[row]![column]![bit]!;

        if (rank < revealed) {
          shown |= 1 << bit;
          glowing ||= rank >= revealed - glow && revealed < logoDotCount;
        }
      }

      if (shown === 0) {
        return `${cell.prefix} `;
      }

      return `${glowing ? glowPrefix : cell.prefix}${String.fromCodePoint(brailleBase + shown)}`;
    });

    return `${cells.join("")}${line.suffix}`;
  });
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  let seed = 0x5ab1e;
  const next = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);

    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(next() * (index + 1));

    [result[index], result[swap]] = [result[swap]!, result[index]!];
  }

  return result;
}
