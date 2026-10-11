import type { TuiStyle } from "./style.js";

export type KeyHint = readonly [key: string, label: string];

export function formatKeyHints(hints: readonly KeyHint[], style: TuiStyle): string {
  return hints.map(([key, label]) => `${style.key(key)} ${style.muted(label)}`).join("  ");
}
