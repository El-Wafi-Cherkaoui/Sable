import { mapDashboardKey } from "../input/keymap.js";
import type { KeyInput } from "../input/terminal-key-input.js";
import type { RuntimeWorkspaceState } from "../runtime/runtime-state.js";
import { renderStaticDashboard } from "./static-dashboard.js";

export type InteractiveDashboardController = {
  getState(): RuntimeWorkspaceState;
  selectNextService(): RuntimeWorkspaceState;
  selectPreviousService(): RuntimeWorkspaceState;
};

export type InteractiveDashboardScreen = {
  clear(): void;
  write(contents: string): void;
};

export type RunInteractiveDashboardOptions = {
  controller: InteractiveDashboardController;
  keyInput: KeyInput;
  screen?: InteractiveDashboardScreen;
  render?: typeof renderStaticDashboard;
};

export async function runInteractiveDashboard(
  options: RunInteractiveDashboardOptions,
): Promise<void> {
  const screen = options.screen ?? terminalScreen;
  const render = options.render ?? renderStaticDashboard;
  let shouldQuit = false;

  renderFrame(screen, render(options.controller.getState()));

  while (!shouldQuit) {
    const action = mapDashboardKey(await options.keyInput.readKey());

    switch (action) {
      case "selectNext":
        options.controller.selectNextService();
        renderFrame(screen, render(options.controller.getState()));
        break;
      case "selectPrevious":
        options.controller.selectPreviousService();
        renderFrame(screen, render(options.controller.getState()));
        break;
      case "quit":
        shouldQuit = true;
        break;
      case "none":
        break;
    }
  }
}

function renderFrame(screen: InteractiveDashboardScreen, contents: string): void {
  screen.clear();
  screen.write(`${contents}\n`);
}

const terminalScreen: InteractiveDashboardScreen = {
  clear() {
    process.stdout.write("\x1b[2J\x1b[H");
  },
  write(contents) {
    process.stdout.write(contents);
  },
};
