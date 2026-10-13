import type { ItemKind } from "../config/config-types.js";
import type { ManagedProcessState } from "../process/process-manager.js";

export type PlanItem = {
  id: string;
  name: string;
  kind: ItemKind;
  after: string[];
};

// What the dashboard shows for an item the plan has not started yet, or has given up on.
export type QueueMark =
  | { status: "waiting"; for: string[] }
  | { status: "skipped"; reason: string };

export type StartPlanDeps = {
  // Every item of the workspace; the plan starts `targets` and whatever they wait for.
  items: PlanItem[];
  targets: string[];
  getProcess(itemId: string): ManagedProcessState;
  start(itemId: string): Promise<unknown>;
  mark(itemId: string, mark: QueueMark | undefined): void;
  // The user stopped this item (or the app is closing) before the plan got to it.
  isDropped(itemId: string): boolean;
  // Why an item cannot be started at all (e.g. a secret it needs is not set); it is skipped, and so is what waits for it.
  blockedReason?(itemId: string): string | undefined;
  // How long a service must stay alive before the items that wait for it may start.
  upAfterMs: number;
  pollMs: number;
  now(): number;
  sleep(milliseconds: number): Promise<void>;
};

export type StartPlan = {
  // Resolves once everything that could start right away has been started.
  firstPass: Promise<void>;
  // Resolves when every item has been started, skipped or given up on.
  done: Promise<void>;
};

type Phase = "pending" | "starting" | "ready" | "failed";

// Starts items in dependency order. A service counts as up once it has stayed alive for
// `upAfterMs`; a command counts as done when it exits with code 0. An item whose prerequisite
// did not make it is skipped, and so is everything that waited for that item.
export function runStartPlan(deps: StartPlanDeps): StartPlan {
  let resolveFirstPass: () => void = () => {};
  let rejectFirstPass: (error: unknown) => void = () => {};
  const firstPass = new Promise<void>((resolve, reject) => {
    resolveFirstPass = resolve;
    rejectFirstPass = reject;
  });
  const done = execute(deps, resolveFirstPass);

  done.then(resolveFirstPass, rejectFirstPass);
  // A caller that only wants the background plan never awaits this; its error shows up on `done`.
  firstPass.catch(() => undefined);

  return { firstPass, done };
}

async function execute(deps: StartPlanDeps, firstPassDone: () => void): Promise<void> {
  const byId = new Map(deps.items.map((item) => [item.id, item]));
  const needed = withPrerequisites(byId, deps.targets);
  // Only items that something else waits for need to prove they are up (or done); the rest are
  // finished as soon as they are started, so the plan does not outlast the last real wait.
  const waitedFor = new Set(needed.flatMap((id) => byId.get(id)!.after));
  const phase = new Map<string, Phase>();
  const failure = new Map<string, string>();
  const startedAt = new Map<string, number>();
  const lastMark = new Map<string, string>();

  const mark = (itemId: string, next: QueueMark | undefined) => {
    const signature = JSON.stringify(next ?? null);

    if (lastMark.get(itemId) !== signature) {
      lastMark.set(itemId, signature);
      deps.mark(itemId, next);
    }
  };

  for (const id of needed) {
    const process = deps.getProcess(id);
    const item = byId.get(id)!;

    mark(id, undefined);

    if (process.status === "running") {
      // A service that is already up needs no wait; a running command has to finish first.
      phase.set(id, item.kind === "service" ? "ready" : "starting");
      startedAt.set(id, deps.now());
    } else {
      phase.set(id, "pending");
    }
  }

  // Starts are not awaited one by one, so independent items start together.
  const starts: Array<Promise<unknown>> = [];
  let isFirstPass = true;

  while ([...phase.values()].some((value) => value === "pending" || value === "starting")) {
    let progressed = false;

    for (const id of needed) {
      const item = byId.get(id)!;
      const current = phase.get(id);

      if (current !== "pending" && current !== "starting") {
        continue;
      }

      if (deps.isDropped(id)) {
        phase.set(id, "failed");
        failure.set(id, "was stopped");
        mark(id, undefined);
        progressed = true;
        continue;
      }

      if (current === "pending") {
        const waitsFor = item.after.filter((afterId) => phase.has(afterId));
        const blocker = waitsFor.find((afterId) => phase.get(afterId) === "failed");

        if (blocker !== undefined) {
          phase.set(id, "failed");
          failure.set(id, "was skipped");
          mark(id, { status: "skipped", reason: `${byId.get(blocker)!.name} ${failure.get(blocker) ?? "did not start"}` });
          progressed = true;
        } else if (waitsFor.every((afterId) => phase.get(afterId) === "ready")) {
          const blocked = deps.blockedReason?.(id);

          if (blocked !== undefined) {
            phase.set(id, "failed");
            failure.set(id, "was skipped");
            mark(id, { status: "skipped", reason: blocked });
            progressed = true;
            continue;
          }

          phase.set(id, waitedFor.has(id) ? "starting" : "ready");
          startedAt.set(id, deps.now());
          mark(id, undefined);
          starts.push(deps.start(id));
          progressed = true;
        } else {
          mark(id, {
            status: "waiting",
            for: waitsFor.filter((afterId) => phase.get(afterId) !== "ready").map((afterId) => byId.get(afterId)!.name),
          });
        }

        continue;
      }

      const verdict = judge(item, deps.getProcess(id), deps.now() - (startedAt.get(id) ?? 0), deps.upAfterMs);

      if (verdict === "ready") {
        phase.set(id, "ready");
        progressed = true;
      } else if (verdict === "failed") {
        phase.set(id, "failed");
        failure.set(id, item.kind === "service" ? "stopped early" : "failed");
        progressed = true;
      }
    }

    if (isFirstPass) {
      isFirstPass = false;
      await Promise.all(starts);
      firstPassDone();
    }

    if (!progressed) {
      // Nothing is running that could unblock the rest: they wait on each other (a hand-edited loop).
      if (![...phase.values()].some((value) => value === "starting")) {
        for (const [id, value] of phase) {
          if (value === "pending") {
            phase.set(id, "failed");
            mark(id, { status: "skipped", reason: "items wait for each other in a loop" });
          }
        }

        break;
      }

      await deps.sleep(deps.pollMs);
    }
  }

  await Promise.all(starts);
}

function judge(
  item: PlanItem,
  process: ManagedProcessState,
  elapsedMs: number,
  upAfterMs: number,
): "ready" | "failed" | "waiting" {
  if (item.kind === "service") {
    if (process.status !== "running") {
      return "failed";
    }

    return elapsedMs >= upAfterMs ? "ready" : "waiting";
  }

  if (process.status === "running") {
    return "waiting";
  }

  return process.status === "exited" && process.exitCode === 0 && process.signal === null ? "ready" : "failed";
}

// The targets and, one level after another, everything they wait for. Unknown ids are ignored.
function withPrerequisites(byId: Map<string, PlanItem>, targets: string[]): string[] {
  const needed = new Set<string>();
  const queue = [...targets];

  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    const item = byId.get(id);

    if (item === undefined || needed.has(id)) {
      continue;
    }

    needed.add(id);
    queue.push(...item.after);
  }

  return [...needed];
}
