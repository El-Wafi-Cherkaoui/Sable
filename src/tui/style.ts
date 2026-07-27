export type TuiStyle = {
  title(text: string): string;
  selected(text: string): string;
  border(text: string): string;
  statusLabel(text: string): string;
  muted(text: string): string;
  running(text: string): string;
  failed(text: string): string;
  exited(text: string): string;
  stream(stream: "stdout" | "stderr" | "system"): string;
};

export type StyleEnvironment = {
  NO_COLOR?: string;
  FORCE_COLOR?: string;
};

export type ColorSupportStream = {
  isTTY?: boolean;
};

export function shouldUseColor(
  stream: ColorSupportStream = process.stdout,
  environment: StyleEnvironment = process.env,
): boolean {
  if (environment.NO_COLOR !== undefined) {
    return false;
  }

  if (environment.FORCE_COLOR !== undefined && environment.FORCE_COLOR !== "0") {
    return true;
  }

  return stream.isTTY === true;
}

export function createTuiStyle(enabled = false): TuiStyle {
  if (!enabled) {
    return plainStyle;
  }

  return {
    title: ansi("\x1b[1m", "\x1b[22m"),
    selected: ansi("\x1b[48;5;236m", "\x1b[49m"),
    border: ansi("\x1b[2m", "\x1b[22m"),
    statusLabel: ansi("\x1b[36m\x1b[1m", "\x1b[22m\x1b[39m"),
    muted: ansi("\x1b[2m", "\x1b[22m"),
    running: ansi("\x1b[32m", "\x1b[39m"),
    failed: ansi("\x1b[31m", "\x1b[39m"),
    exited: ansi("\x1b[33m", "\x1b[39m"),
    stream(stream) {
      switch (stream) {
        case "stderr":
          return ansi("\x1b[31m", "\x1b[39m")(stream.padEnd(6));
        case "system":
          return ansi("\x1b[36m", "\x1b[39m")(stream.padEnd(6));
        case "stdout":
          return ansi("\x1b[2m", "\x1b[22m")(stream.padEnd(6));
      }
    },
  };
}

export const plainStyle: TuiStyle = {
  title: identity,
  selected: identity,
  border: identity,
  statusLabel: identity,
  muted: identity,
  running: identity,
  failed: identity,
  exited: identity,
  stream(stream) {
    return stream.padEnd(6);
  },
};

function ansi(open: string, close: string): (text: string) => string {
  return (text) => `${open}${text}${close}`;
}

function identity(text: string): string {
  return text;
}
