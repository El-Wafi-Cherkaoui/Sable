import { emitKeypressEvents } from "node:readline";
import type { Keypress } from "./keymap.js";

export type KeyInput = {
  readKey(): Promise<Keypress>;
  close(): void;
};

export class TerminalKeyInput implements KeyInput {
  private readonly input: NodeJS.ReadStream;
  private readonly wasRaw: boolean;

  constructor(input: NodeJS.ReadStream = process.stdin) {
    this.input = input;
    this.wasRaw = Boolean(input.isRaw);
    emitKeypressEvents(input);

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
    if (this.input.isTTY) {
      this.input.setRawMode(this.wasRaw);
    }
  }
}
