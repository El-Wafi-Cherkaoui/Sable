import type { SettingsStore } from "./settings-store.js";

// The full logo shows on the first launch each day; later launches that day
// get a short one. Returns true when this launch is the first of the day, and
// remembers it. Any failure just means the full logo.
export async function claimFullSplash(store: SettingsStore, today: Date = new Date()): Promise<boolean> {
  const day = localDay(today);

  try {
    if ((await store.load()).lastSplashDay === day) {
      return false;
    }

    await store.update({ lastSplashDay: day });
  } catch {
    // Not remembering only means seeing the full logo again.
  }

  return true;
}

export function localDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${date.getFullYear()}-${month}-${day}`;
}
