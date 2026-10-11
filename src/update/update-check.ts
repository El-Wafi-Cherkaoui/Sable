import { promises as fs } from "node:fs";
import path from "node:path";
import { product } from "../shared/product.js";

const checkIntervalMs = 24 * 60 * 60 * 1000;
const requestTimeoutMs = 1_500;

export type UpdateCheckEnvironment = Record<string, string | undefined>;

export type UpdateCache = {
  checkedAt: number;
  latest: string;
};

export type UpdateCheckOptions = {
  currentVersion?: string;
  cacheFile: string;
  env?: UpdateCheckEnvironment;
  isInteractive?: boolean;
  now?: () => number;
  fetchLatest?: (signal: AbortSignal) => Promise<string>;
};

export type UpdateCheck = {
  // A newer version, if one is known right now (from the cache or a finished check).
  newerVersion(): string | undefined;
  // Stops a request still in flight so quitting Sable never waits on the network.
  cancel(): void;
  // Settles when the background check is done; never rejects.
  done: Promise<void>;
};

// Checks npm for a newer Sable at most once a day, in the background. Every
// failure (offline, timeout, bad cache) is silent: an update notice is never
// worth slowing down or breaking a launch.
export function startUpdateCheck(options: UpdateCheckOptions): UpdateCheck {
  const currentVersion = options.currentVersion ?? product.version;
  const now = options.now ?? Date.now;
  const abort = new AbortController();
  let latest: string | undefined;

  const newerVersion = () => latest !== undefined && isNewerVersion(latest, currentVersion) ? latest : undefined;

  if (!isUpdateCheckEnabled(options.env ?? process.env, options.isInteractive ?? process.stdout.isTTY === true)) {
    return { newerVersion: () => undefined, cancel() {}, done: Promise.resolve() };
  }

  const done = (async () => {
    const cache = await readCache(options.cacheFile);

    if (cache !== undefined) {
      latest = cache.latest;

      if (now() - cache.checkedAt < checkIntervalMs) {
        return;
      }
    }

    // Sable may have quit while the cache was being read.
    if (abort.signal.aborted) {
      return;
    }

    const timeout = setTimeout(() => abort.abort(), requestTimeoutMs);

    timeout.unref?.();

    try {
      latest = await (options.fetchLatest ?? fetchLatestVersion)(abort.signal);
      await writeCache(options.cacheFile, { checkedAt: now(), latest });
    } catch {
      // Offline, timed out, or cancelled: keep whatever the cache said.
    } finally {
      clearTimeout(timeout);
    }
  })();

  return { newerVersion, cancel: () => abort.abort(), done };
}

export function isUpdateCheckEnabled(env: UpdateCheckEnvironment, isInteractive: boolean): boolean {
  return isInteractive
    && env.NO_UPDATE_NOTIFIER === undefined
    && env.SABLE_NO_UPDATE_CHECK === undefined
    && (env.CI === undefined || env.CI === "false" || env.CI === "0");
}

export function formatUpdateNotice(version: string): string {
  return `Sable ${version} is available: npm install -g ${product.npmPackageName}`;
}

export function updateCacheFile(configDirectory: string): string {
  return path.join(configDirectory, "update-check.json");
}

// Compares release versions like 0.10.2 > 0.9.9. Pre-releases (0.3.0-beta) are
// never offered as updates.
export function isNewerVersion(candidate: string, current: string): boolean {
  const parse = (version: string) => /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim())?.slice(1).map(Number);
  const next = parse(candidate);
  const now = parse(current.replace(/-.*$/, ""));

  if (next === undefined || now === undefined) {
    return false;
  }

  for (let index = 0; index < 3; index += 1) {
    if (next[index]! !== now[index]!) {
      return next[index]! > now[index]!;
    }
  }

  return false;
}

async function fetchLatestVersion(signal: AbortSignal): Promise<string> {
  const response = await fetch(`https://registry.npmjs.org/${product.npmPackageName}/latest`, {
    signal,
    headers: { accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`npm registry answered ${response.status}`);
  }

  const body = (await response.json()) as { version?: unknown };

  if (typeof body.version !== "string") {
    throw new Error("npm registry response had no version");
  }

  return body.version;
}

async function readCache(file: string): Promise<UpdateCache | undefined> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8")) as Partial<UpdateCache>;

    return typeof parsed.checkedAt === "number" && typeof parsed.latest === "string"
      ? { checkedAt: parsed.checkedAt, latest: parsed.latest }
      : undefined;
  } catch {
    return undefined;
  }
}

async function writeCache(file: string, cache: UpdateCache): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(cache)}\n`, "utf8");
}
