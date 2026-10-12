import { describe, expect, it } from "vitest";
import { highlightAnsi, sliceAnsi, truncateAnsi, wrapAnsi } from "./ansi-text.js";

const red = "\x1b[31m";
const reset = "\x1b[0m";

describe("sliceAnsi", () => {
  it("re-applies the color active at the start and resets at the end", () => {
    expect(sliceAnsi(`${red}abcdef${reset}`, 2, 3)).toBe(`${red}cde${reset}`);
  });

  it("leaves uncolored text alone", () => {
    expect(sliceAnsi("abcdef", 2)).toBe("cdef");
  });

  it("forgets a color that was reset before the start", () => {
    expect(sliceAnsi(`${red}ab${reset}cd`, 2)).toBe("cd");
  });
});

describe("truncateAnsi", () => {
  it("returns short lines untouched", () => {
    expect(truncateAnsi(`${red}ok${reset}`, 10)).toBe(`${red}ok${reset}`);
  });

  it("keeps colors and closes them before the ellipsis", () => {
    expect(truncateAnsi(`${red}abcdefghij${reset}`, 8)).toBe(`${red}abcde${reset}...`);
  });
});

describe("wrapAnsi", () => {
  it("makes every row stand on its own", () => {
    expect(wrapAnsi(`${red}abcdef${reset}`, 4)).toEqual([`${red}abcd${reset}`, `${red}ef${reset}`]);
  });

  it("never splits a color code", () => {
    const rows = wrapAnsi(`ab${red}cd${reset}ef`, 2);

    expect(rows.join("")).not.toMatch(/\x1b(?!\[)/); // eslint-disable-line no-control-regex
    expect(rows.map((row) => row.replace(/\x1b\[[0-9;]*m/g, ""))).toEqual(["ab", "cd", "ef"]); // eslint-disable-line no-control-regex
  });

  it("puts a wide character that does not fit on the next row", () => {
    expect(wrapAnsi("a日b", 2)).toEqual(["a", "日", "b"]);
  });

  it("returns one empty row for an empty line", () => {
    expect(wrapAnsi("", 5)).toEqual([""]);
  });
});

describe("highlightAnsi", () => {
  it("matches the visible text, not the color codes", () => {
    expect(highlightAnsi(`${red}error 31${reset}`, "31")).toBe(`${red}error \x1b[7m31${reset}\x1b[27m`);
    expect(highlightAnsi(`${red}ok${reset}`, "31")).toBe(`${red}ok${reset}`);
  });

  it("highlights a match that spans a color change", () => {
    expect(highlightAnsi(`ab${red}cd`, "bc")).toBe(`a\x1b[7mb${red}c\x1b[27md`);
  });
});
