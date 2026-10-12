import { createInterface, emitKeypressEvents, type Interface } from "node:readline";
import type { Keypress } from "./keymap.js";

export type KeyInput = {
  readKey(): Promise<Keypress>;
  close(): void;
};

export const resizeKeyName = "resize";

export class TerminalKeyInput implements KeyInput {
  private readonly input: NodeJS.ReadStream;
  private readonly output: NodeJS.EventEmitter;
  private readonly readlineInterface: Interface;
  private readonly wasRaw: boolean;
  // Keys are queued so none are lost when several arrive at once (e.g. a paste):
  // readline emits them synchronously, before the next readKey() call.
  private readonly queuedKeys: Keypress[] = [];
  private waiters: Array<(keypress: Keypress) => void> = [];
  private closed = false;

  constructor(input: NodeJS.ReadStream = process.stdin, output: NodeJS.EventEmitter = process.stdout) {
    this.input = input;
    this.output = output;
    this.wasRaw = Boolean(input.isRaw);
    this.readlineInterface = createInterface({
      input,
      escapeCodeTimeout: 10,
    });
    emitKeypressEvents(input, this.readlineInterface);
    input.on("keypress", this.handleKeypress);
    output.on("resize", this.handleResize);

    if (input.isTTY) {
      input.setRawMode(true);
    }

    input.resume();
  }

  readKey(): Promise<Keypress> {
    const queuedKey = this.queuedKeys.shift();

    if (queuedKey !== undefined) {
      return Promise.resolve(queuedKey);
    }

    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  private readonly handleKeypress = (_chunk: string, key: Keypress): void => {
    if (this.waiters.length === 0) {
      this.queuedKeys.push(key);
      return;
    }

    // Every pending reader sees the key, as with the previous once-listener per read.
    const waiters = this.waiters;

    this.waiters = [];

    for (const resolve of waiters) {
      resolve(key);
    }
  };

  // A resize wakes the screen that is waiting for a key so it can redraw at the new size.
  private readonly handleResize = (): void => {
    this.handleKeypress("", { name: resizeKeyName });
  };

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.input.off("keypress", this.handleKeypress);
    this.output.off("resize", this.handleResize);

    try {
      if (this.input.isTTY) {
        this.input.setRawMode(this.wasRaw);
      }
    } catch {
      // Terminal cleanup is best-effort; continue with the remaining cleanup steps.
    }

    try {
      this.readlineInterface.close();
    } catch {
      // Terminal cleanup is best-effort; continue with the remaining cleanup steps.
    }

    try {
      this.input.pause();
    } catch {
      // Terminal cleanup is best-effort.
    }
  }
}
