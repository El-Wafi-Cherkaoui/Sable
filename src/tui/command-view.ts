export type RenderCommandViewOptions = {
  input: string;
  error?: string;
};

export type CommandResult =
  | { type: "quit" }
  | { type: "help" }
  | { type: "unknown"; message: string };

export function renderCommandView(options: RenderCommandViewOptions): string {
  const lines = ["Command", "", `:${options.input}`];

  if (options.error !== undefined) {
    lines.push("", options.error);
  }

  lines.push("", "Enter run  Esc cancel");

  return lines.join("\n");
}

export function parseCommand(input: string): CommandResult {
  const command = input.trim().toLowerCase();

  if (command === "q" || command === "quit") {
    return { type: "quit" };
  }

  if (command === "h" || command === "help") {
    return { type: "help" };
  }

  return {
    type: "unknown",
    message: `Unknown command: ${input.trim()}`,
  };
}
