import { mapLogsKey } from "../input/keymap.js";
import type { KeyInput } from "../input/terminal-key-input.js";
import type { ServiceLogEntry } from "../process/process-manager.js";
import {
  bottomScrollOffset,
  clampScrollOffset,
  errorIndexes,
  findMatches,
  nextIndex,
  type LogsLayout,
  type LogsSearch,
  type RenderLogsViewOptions,
} from "./logs-view.js";

type Keypress = Awaited<ReturnType<KeyInput["readKey"]>>;

// What the dashboard should do after a key in the logs view.
export type LogsKeyResult = "render" | "none" | "openHelp" | "back";

export type LogsSession = {
  open(): void;
  refresh(): void;
  resize(): void;
  handleKey(keypress: Keypress): LogsKeyResult;
  // Props for the logs renderer; the dashboard adds state and color.
  viewProps(): Pick<
    RenderLogsViewOptions,
    | "logs"
    | "scrollOffset"
    | "following"
    | "visibleLineCount"
    | "revealLineCount"
    | "horizontalScrollOffset"
    | "viewportColumns"
    | "wrap"
    | "search"
    | "highlightIndex"
    | "message"
  >;
  isRevealActive(): boolean;
};

export type LogsSessionOptions = {
  getLogs(): ServiceLogEntry[];
  // Fixed height for tests; otherwise it follows the terminal rows.
  visibleLineCount?: number;
};

export function createLogsSession(options: LogsSessionOptions): LogsSession {
  let scrollOffset = 0;
  let horizontalScrollOffset = 0;
  let followTail = true;
  let revealLineCount: number | undefined;
  let wrap = false;
  let search: LogsSearch | undefined;
  let highlightIndex: number | undefined;
  let message: string | undefined;

  function getVisibleLineCount(): number {
    if (options.visibleLineCount !== undefined) {
      return options.visibleLineCount;
    }

    const rows = process.stdout.rows;

    if (rows === undefined || rows <= 0) {
      return 12;
    }

    // Header, blank, blank, search line, footer, and one row of scroll margin.
    return Math.max(3, rows - 6);
  }

  function getLayout(): LogsLayout {
    return {
      height: getVisibleLineCount(),
      width: Math.max(23, (process.stdout.columns ?? 80) - 1),
      wrap,
    };
  }

  function syncScroll(logs: ServiceLogEntry[]): void {
    scrollOffset = followTail
      ? bottomScrollOffset(logs, getLayout())
      : clampScrollOffset(scrollOffset, logs, getLayout());
  }

  // Shows a found line a third of the way down, so there is context above and below it.
  function jumpToLine(index: number | undefined, logs: ServiceLogEntry[]): void {
    highlightIndex = index;

    if (index === undefined) {
      return;
    }

    followTail = false;
    scrollOffset = clampScrollOffset(index - Math.floor(getVisibleLineCount() / 3), logs, getLayout());
  }

  function advanceReveal(logLineCount: number): void {
    if (revealLineCount === undefined) {
      return;
    }

    const visibleLogCount = resolveVisibleLogCount(logLineCount, getVisibleLineCount());
    const nextRevealLineCount = revealLineCount + resolveLogRevealStep(visibleLogCount);

    revealLineCount = nextRevealLineCount >= visibleLogCount
      ? undefined
      : nextRevealLineCount;
  }

  function handleSearchKey(keypress: Keypress, logs: ServiceLogEntry[]): void {
    if (search === undefined) {
      return;
    }

    if (keypress.name === "escape") {
      search = undefined;
    } else if (keypress.name === "return" || keypress.sequence === "\r") {
      search = search.query === "" ? undefined : { query: search.query, editing: false };

      if (search !== undefined) {
        jumpToLine(findMatches(logs, search.query).at(-1), logs);
      }
    } else if (keypress.name === "backspace") {
      search = { ...search, query: search.query.slice(0, -1) };
    } else if (keypress.sequence !== undefined && keypress.ctrl !== true && keypress.sequence >= " " && keypress.sequence !== "\x7f") {
      search = { ...search, query: search.query + keypress.sequence };
    }
  }

  return {
    open() {
      const logs = options.getLogs();

      followTail = true;
      horizontalScrollOffset = 0;
      search = undefined;
      highlightIndex = undefined;
      message = undefined;
      revealLineCount = resolveInitialLogRevealLineCount(logs.length, getVisibleLineCount());
      scrollOffset = bottomScrollOffset(logs, getLayout());
    },

    refresh() {
      const logs = options.getLogs();

      syncScroll(logs);
      advanceReveal(logs.length);
    },

    resize() {
      syncScroll(options.getLogs());
    },

    handleKey(keypress) {
      const logs = options.getLogs();

      revealLineCount = undefined;
      message = undefined;

      if (search?.editing === true) {
        handleSearchKey(keypress, logs);
        return "render";
      }

      const action = mapLogsKey(keypress);

      switch (action) {
        case "scrollDown":
          scrollOffset = clampScrollOffset(scrollOffset + 1, logs, getLayout());
          followTail = scrollOffset === bottomScrollOffset(logs, getLayout());
          break;
        case "scrollUp":
          scrollOffset = clampScrollOffset(scrollOffset - 1, logs, getLayout());
          followTail = false;
          break;
        case "scrollTop":
          scrollOffset = 0;
          followTail = false;
          break;
        case "scrollBottom":
          scrollOffset = bottomScrollOffset(logs, getLayout());
          followTail = true;
          highlightIndex = undefined;
          break;
        case "scrollLeft":
          horizontalScrollOffset = Math.max(0, horizontalScrollOffset - 8);
          break;
        case "scrollRight":
          horizontalScrollOffset += 8;
          break;
        case "resetHorizontalScroll":
          horizontalScrollOffset = 0;
          break;
        case "search":
          search = { query: "", editing: true };
          break;
        case "nextMatch":
        case "previousMatch":
          if (search !== undefined) {
            jumpToLine(nextIndex(findMatches(logs, search.query), highlightIndex, action === "nextMatch" ? 1 : -1), logs);
          }
          break;
        case "nextError": {
          const errorLine = nextIndex(errorIndexes(logs), highlightIndex ?? scrollOffset - 1, 1);

          if (errorLine === undefined) {
            message = "No errors in this output.";
          } else {
            jumpToLine(errorLine, logs);
          }
          break;
        }
        case "toggleWrap":
          wrap = !wrap;
          horizontalScrollOffset = 0;
          if (followTail) {
            scrollOffset = bottomScrollOffset(logs, getLayout());
          }
          break;
        case "openHelp":
          return "openHelp";
        case "back":
          // Esc first clears an active search; only then does it leave the logs.
          if (search === undefined) {
            return "back";
          }

          search = undefined;
          highlightIndex = undefined;
          break;
        case "none":
          return "none";
      }

      return "render";
    },

    viewProps() {
      const logs = options.getLogs();

      scrollOffset = clampScrollOffset(scrollOffset, logs, getLayout());

      return {
        logs,
        scrollOffset,
        following: followTail,
        visibleLineCount: getVisibleLineCount(),
        revealLineCount,
        horizontalScrollOffset,
        viewportColumns: process.stdout.columns,
        wrap,
        search,
        highlightIndex,
        message,
      };
    },

    isRevealActive() {
      return revealLineCount !== undefined;
    },
  };
}

function resolveInitialLogRevealLineCount(
  logLineCount: number,
  visibleLineCount: number,
): number | undefined {
  const visibleLogCount = resolveVisibleLogCount(logLineCount, visibleLineCount);

  if (visibleLogCount <= 3) {
    return undefined;
  }

  return Math.max(1, Math.ceil(visibleLogCount / 3));
}

function resolveVisibleLogCount(logLineCount: number, visibleLineCount: number): number {
  return Math.min(logLineCount, visibleLineCount);
}

function resolveLogRevealStep(visibleLogCount: number): number {
  return Math.max(1, Math.ceil(visibleLogCount / 3));
}
