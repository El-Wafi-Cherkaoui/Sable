import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const readlineMocks = vi.hoisted(() => ({
  close: vi.fn(),
  createInterface: vi.fn(),
  emitKeypressEvents: vi.fn(),
}));

readlineMocks.createInterface.mockImplementation(() => ({
  close: readlineMocks.close,
}));

vi.mock("node:readline", () => readlineMocks);

import { TerminalKeyInput } from "./terminal-key-input.js";

describe("TerminalKeyInput", () => {
  beforeEach(() => {
    readlineMocks.close.mockClear();
    readlineMocks.createInterface.mockClear();
    readlineMocks.emitKeypressEvents.mockClear();
  });

  it("resumes input on creation and pauses input on close", () => {
    const input = createInput({ isTTY: true, isRaw: false });

    const keyInput = new TerminalKeyInput(input);
    keyInput.close();

    expect(input.resume).toHaveBeenCalledOnce();
    expect(input.setRawMode).toHaveBeenNthCalledWith(1, true);
    expect(input.setRawMode).toHaveBeenNthCalledWith(2, false);
    expect(readlineMocks.close).toHaveBeenCalledOnce();
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
    expect(readlineMocks.close).toHaveBeenCalledTimes(1);
    expect(input.pause).toHaveBeenCalledOnce();
  });

  it("uses a short escape code timeout for faster Esc handling", () => {
    const input = createInput({ isTTY: true, isRaw: false });

    const keyInput = new TerminalKeyInput(input);
    keyInput.close();

    expect(readlineMocks.createInterface).toHaveBeenCalledWith({
      input,
      escapeCodeTimeout: 10,
    });
    expect(readlineMocks.emitKeypressEvents).toHaveBeenCalledWith(
      input,
      expect.objectContaining({ close: readlineMocks.close }),
    );
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
