import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { TerminalKeyInput } from "./terminal-key-input.js";

describe("TerminalKeyInput", () => {
  it("resumes input on creation and pauses input on close", () => {
    const input = createInput({ isTTY: true, isRaw: false });

    const keyInput = new TerminalKeyInput(input);
    keyInput.close();

    expect(input.resume).toHaveBeenCalledOnce();
    expect(input.setRawMode).toHaveBeenNthCalledWith(1, true);
    expect(input.setRawMode).toHaveBeenNthCalledWith(2, false);
    expect(input.pause).toHaveBeenCalledOnce();
  });

  it("restores an input that was already raw", () => {
    const input = createInput({ isTTY: true, isRaw: true });

    const keyInput = new TerminalKeyInput(input);
    keyInput.close();

    expect(input.setRawMode).toHaveBeenNthCalledWith(1, true);
    expect(input.setRawMode).toHaveBeenNthCalledWith(2, true);
  });

  it("closes idempotently", () => {
    const input = createInput({ isTTY: true, isRaw: false });

    const keyInput = new TerminalKeyInput(input);
    keyInput.close();
    keyInput.close();

    expect(input.setRawMode).toHaveBeenCalledTimes(2);
    expect(input.pause).toHaveBeenCalledOnce();
  });
});

function createInput(options: { isTTY: boolean; isRaw: boolean }): NodeJS.ReadStream {
  const input = new EventEmitter() as EventEmitter & {
    isTTY: boolean;
    isRaw: boolean;
    setRawMode: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
  };

  input.isTTY = options.isTTY;
  input.isRaw = options.isRaw;
  input.setRawMode = vi.fn();
  input.resume = vi.fn();
  input.pause = vi.fn();

  return input as unknown as NodeJS.ReadStream;
}
