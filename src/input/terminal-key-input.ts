import { createInterface, emitKeypressEvents, type Interface } from "node:readline";
import type { Keypress } from "./keymap.js";

export type KeyInput = {
  readKey(): Promise<Keypress>;
  close(): void;
};

export class TerminalKeyInput implements KeyInput {
  private readonly input: NodeJS.ReadStream;
  private readonly readlineInterface: Interface;
  private readonly wasRaw: boolean;
  private closed = false;

  constructor(input: NodeJS.ReadStream = process.stdin) {
    this.input = input;
    this.wasRaw = Boolean(input.isRaw);
    this.readlineInterface = createInterface({
      input,
      escapeCodeTimeout: 10,
    });
    emitKeypressEvents(input, this.readlineInterface);

    if (input.isTTY) {
      input.setRawMode(true);
    }

    input.resume();
  }

  readKey(): Promise<Keypress> {
    return new Promise((resolve) => {
      this.input.once("keypress", (_chunk: string, key: Keypress) => {
        resolve(key);
      });
    });
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;

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
