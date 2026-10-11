import type { TuiStyle } from "./style.js";
import { visibleLength } from "./width.js";

export type KeyHint = readonly [key: string, label: string];

// When a width is given, hints are dropped from the end (keeping the last one,
// usually back or quit) until the row fits, so it never wraps and shifts the screen.
export function formatKeyHints(hints: readonly KeyHint[], style: TuiStyle, maxWidth?: number): string {
  let shown = [...hints];
  const render = () => shown.map(([key, label]) => `${style.key(key)} ${style.muted(label)}`).join("  ");

  while (maxWidth !== undefined && shown.length > 1 && visibleLength(render()) > maxWidth) {
    shown = [...shown.slice(0, -2), shown.at(-1)!];
  }

  return render();
}
