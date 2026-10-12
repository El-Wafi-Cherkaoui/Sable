import { promises as fs } from "node:fs";
import path from "node:path";

export type Settings = {
  sound: boolean;
};

export type SettingsStore = {
  load(): Promise<Settings>;
  save(settings: Settings): Promise<void>;
};

const defaultSettings: Settings = { sound: true };

export function settingsFile(configDirectory: string): string {
  return path.join(configDirectory, "settings.json");
}

// Preferences live beside the workspaces file, not inside it, so a settings
// problem can never affect saved workspaces. A missing or unreadable file
// just means the defaults.
export function createSettingsStore(file: string): SettingsStore {
  return {
    async load() {
      try {
        const parsed: unknown = JSON.parse(await fs.readFile(file, "utf8"));
        const sound = typeof parsed === "object" && parsed !== null ? (parsed as { sound?: unknown }).sound : undefined;

        return { sound: typeof sound === "boolean" ? sound : defaultSettings.sound };
      } catch {
        return { ...defaultSettings };
      }
    },
    async save(settings) {
      const temp = `${file}.${process.pid}.tmp`;

      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(temp, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
      await fs.rename(temp, file);
    },
  };
}
