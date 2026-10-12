export class TerminalRequiredError extends Error {
  constructor() {
    super("Sable needs an interactive terminal. Run it directly in a terminal, or use `sable list` to see your workspaces.");
    this.name = "TerminalRequiredError";
  }
}

type TerminalStreams = {
  stdin: { isTTY?: boolean };
  stdout: { isTTY?: boolean };
};

// The screens read single keys and draw with cursor codes, so with piped input or output
// they would print escape codes into the pipe and wait for keys that never come.
export function requireTerminal(streams: TerminalStreams = process): void {
  if (streams.stdin.isTTY !== true || streams.stdout.isTTY !== true) {
    throw new TerminalRequiredError();
  }
}
