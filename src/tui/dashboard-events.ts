import type { KeyInput } from "../input/terminal-key-input.js";

export type DashboardEvent =
  | { type: "key"; keypress: Awaited<ReturnType<KeyInput["readKey"]>> }
  | { type: "refresh" }
  | { type: "abort" };

export type DashboardEventReader = {
  // Waits for a key, but gives up after refreshIntervalMs so the screen can redraw.
  readKeyOrRefresh(refreshIntervalMs: number): Promise<DashboardEvent>;
  readKeyOrAbort(): Promise<DashboardEvent>;
};

type AbortWait = {
  promise: Promise<void>;
  cleanup(): void;
};

export function createDashboardEventReader(keyInput: KeyInput, abortSignal: AbortSignal | undefined): DashboardEventReader {
  // A key read that lost a race to a refresh stays pending, so the next read reuses it and no key is lost.
  let pendingKeyRead: Promise<Awaited<ReturnType<KeyInput["readKey"]>>> | undefined;

  function readPendingKey(): Promise<Awaited<ReturnType<KeyInput["readKey"]>>> {
    pendingKeyRead ??= keyInput.readKey();

    return pendingKeyRead;
  }

  return {
    async readKeyOrRefresh(refreshIntervalMs) {
      const keyRead = readPendingKey();
      const abortWait = createAbortWait(abortSignal);

      const event = await Promise.race([
        keyRead.then((keypress) => ({ type: "key" as const, keypress })),
        wait(refreshIntervalMs).then(() => ({ type: "refresh" as const })),
        abortWait.promise.then(() => ({ type: "abort" as const })),
      ]).finally(() => abortWait.cleanup());

      if (event.type === "key") {
        pendingKeyRead = undefined;
      }

      return event;
    },

    async readKeyOrAbort() {
      const abortWait = createAbortWait(abortSignal);

      return Promise.race([
        readKeyEvent().then((keypress) => ({ type: "key" as const, keypress })),
        abortWait.promise.then(() => ({ type: "abort" as const })),
      ]).finally(() => abortWait.cleanup());
    },
  };

  async function readKeyEvent(): Promise<Awaited<ReturnType<KeyInput["readKey"]>>> {
    const keypress = await readPendingKey();

    pendingKeyRead = undefined;

    return keypress;
  }
}

function createAbortWait(signal: AbortSignal | undefined): AbortWait {
  if (signal === undefined) {
    return {
      promise: new Promise(() => undefined),
      cleanup() {},
    };
  }

  if (signal.aborted) {
    return {
      promise: Promise.resolve(),
      cleanup() {},
    };
  }

  let abortListener: (() => void) | undefined;

  const promise = new Promise<void>((resolve) => {
    abortListener = () => resolve();
    signal.addEventListener("abort", abortListener, { once: true });
  });

  return {
    promise,
    cleanup() {
      if (abortListener !== undefined) {
        signal.removeEventListener("abort", abortListener);
      }
    },
  };
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
