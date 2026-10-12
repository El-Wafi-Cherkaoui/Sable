import { describe, expect, it } from "vitest";
import { sableLogoAnsi } from "../generated/sable-logo-ansi.js";
import { logoDotCount, renderRevealedLogo } from "./logo-reveal.js";

const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");
const litDots = (lines: string[]) => [...strip(lines.join(""))].reduce((total, char) => {
  const bits = char.codePointAt(0)! - 0x2800;

  return char >= "⠀" && char <= "⣿" ? total + [...bits.toString(2)].filter((bit) => bit === "1").length : total;
}, 0);

describe("renderRevealedLogo", () => {
  it("has hundreds of dots to reveal", () => {
    expect(logoDotCount).toBeGreaterThan(300);
  });

  it("is the finished logo, byte for byte, once every dot is revealed", () => {
    expect(renderRevealedLogo(logoDotCount)).toEqual(sableLogoAnsi);
    expect(renderRevealedLogo(logoDotCount, 40)).toEqual(sableLogoAnsi);
  });

  it("starts with no dots at all", () => {
    expect(litDots(renderRevealedLogo(0))).toBe(0);
  });

  it("keeps the shape: eight lines, the same width every time", () => {
    for (const count of [0, 1, 50, 200, logoDotCount - 1]) {
      const lines = renderRevealedLogo(count, 10);

      expect(lines).toHaveLength(sableLogoAnsi.length);
      expect(lines.map((line) => [...strip(line)].length)).toEqual(sableLogoAnsi.map((line) => [...strip(line)].length));
    }
  });

  it("lights exactly as many dots as were revealed, and only adds dots", () => {
    let previous = 0;

    for (const count of [1, 10, 100, 250, logoDotCount]) {
      const lit = litDots(renderRevealedLogo(count));

      expect(lit).toBeGreaterThanOrEqual(previous);
      expect(lit).toBeGreaterThanOrEqual(Math.min(count, litDots(sableLogoAnsi)) - 0);
      previous = lit;
    }

    expect(litDots(renderRevealedLogo(logoDotCount))).toBe(litDots(sableLogoAnsi));
    expect(litDots(renderRevealedLogo(120))).toBe(120);
  });

  it("reveals in the same order every time", () => {
    expect(renderRevealedLogo(77, 5)).toEqual(renderRevealedLogo(77, 5));
  });

  it("draws the newest dots bright white, and only while the logo is still building", () => {
    const bright = (lines: string[]) => lines.join("").split("\x1b[97m").length - 1;
    const quiet = renderRevealedLogo(200, 0);
    const glowing = renderRevealedLogo(200, 30);

    expect(bright(glowing)).toBeGreaterThan(bright(quiet));
    expect(strip(glowing.join(""))).toBe(strip(quiet.join("")));
    expect(renderRevealedLogo(logoDotCount, 30)).toEqual(sableLogoAnsi);
  });
});
