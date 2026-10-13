import { promises as fs } from "node:fs";
import path from "node:path";

export type Settings = {
  sound: boolean;
  // The full welcome screen at launch; off shows a short version.
  welcomeScreen: boolean;
  // Write each item's output to a file as well; off unless asked for.
  persistLogs: boolean;
  // Short hints on screen, like how to share a workspace; on unless switched off.
  tips: boolean;
};

export type SettingsStore = {
  load(): Promise<Settings>;
  save(settings: Settings): Promise<void>;
  // Changes some settings and keeps the rest.
  update(changes: Partial<Settings>): Promise<void>;
};

const defaultSettings: Settings = { sound: true, welcomeScreen: true, persistLogs: false, tips: true };

export function settingsFile(configDirectory: string): string {
  return path.join(configDirectory, "settings.json");
}

// Preferences live beside the workspaces file, not inside it, so a settings
// problem can never affect saved workspaces. A missing or unreadable file
// just means the defaults.
export function createSettingsStore(file: string): SettingsStore {
  const store: SettingsStore = {
    async load() {
      try {
        const parsed: unknown = JSON.parse(await fs.readFile(file, "utf8"));
        const fields = typeof parsed === "object" && parsed !== null ? parsed as { sound?: unknown; welcomeScreen?: unknown; persistLogs?: unknown; tips?: unknown } : {};

        return {
          sound: typeof fields.sound === "boolean" ? fields.sound : defaultSettings.sound,
          welcomeScreen: typeof fields.welcomeScreen === "boolean" ? fields.welcomeScreen : defaultSettings.welcomeScreen,
          persistLogs: typeof fields.persistLogs === "boolean" ? fields.persistLogs : defaultSettings.persistLogs,
          tips: typeof fields.tips === "boolean" ? fields.tips : defaultSettings.tips,
        };
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
    async update(changes) {
      await store.save({ ...await store.load(), ...changes });
    },
  };

  return store;
}
