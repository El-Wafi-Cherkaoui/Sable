import { readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type PathCompleter = (text: string, base: string) => string[];

const maxSuggestions = 50;

export type PathCompletionOptions = {
  listDirectories?: (directory: string) => string[];
  homeDirectory?: string;
};

// Suggests how to finish a folder path being typed: every subfolder (alphabetically) that
// continues what is typed, each with a trailing separator so the next level can follow.
// Relative paths are read from `base`. Returns only the text to append, best match first.
export function createPathCompleter(options: PathCompletionOptions = {}): PathCompleter {
  const listDirectories = options.listDirectories ?? defaultListDirectories;
  const homeDirectory = options.homeDirectory ?? os.homedir();

  return (text, base) => {
    if (text === "") {
      return [];
    }

    const lastSeparator = Math.max(text.lastIndexOf("/"), text.lastIndexOf(path.sep));
    const directoryPart = text.slice(0, lastSeparator + 1);
    const namePart = text.slice(lastSeparator + 1);
    const directory = directoryPart === ""
      ? base
      : path.resolve(base, expandHome(directoryPart, homeDirectory));
    const caseInsensitive = process.platform === "win32" || process.platform === "darwin";
    const matches = (name: string): boolean => {
      const left = caseInsensitive ? name.toLowerCase() : name;
      const right = caseInsensitive ? namePart.toLowerCase() : namePart;

      return left.startsWith(right) && name.length > namePart.length && (namePart.startsWith(".") || !name.startsWith("."));
    };
    const separator = text.includes("/") || path.sep === "/" ? "/" : path.sep;

    return listDirectories(directory)
      .filter(matches)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, maxSuggestions)
      .map((name) => `${name.slice(namePart.length)}${separator}`);
  };
}

function expandHome(value: string, homeDirectory: string): string {
  return value === "~" || value.startsWith("~/") || value.startsWith(`~${path.sep}`)
    ? path.join(homeDirectory, value.slice(1))
    : value;
}

function defaultListDirectories(directory: string): string[] {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || (entry.isSymbolicLink() && isDirectory(path.join(directory, entry.name))))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function isDirectory(target: string): boolean {
  try {
    return statSync(target).isDirectory();
  } catch {
    return false;
  }
}
