import { describe, expect, it } from "vitest";
import type { ManagedProcessState } from "../process/process-manager.js";
import { runStartPlan, type PlanItem, type QueueMark } from "./start-plan.js";

const running: ManagedProcessState = { status: "running", pid: 1 };
const exited = (exitCode: number): ManagedProcessState => ({ status: "exited", exitCode, signal: null });

function service(id: string, ...after: string[]): PlanItem {
  return { id, name: id, kind: "service", after };
}

function command(id: string, ...after: string[]): PlanItem {
  return { id, name: id, kind: "command", after };
}

// Runs a plan on a simulated clock: sleeping advances time, then `events` may change process states.
function simulate(
  items: PlanItem[],
  targets: string[],
  options: {
    events?: (time: number, set: (id: string, state: ManagedProcessState) => void) => void;
    initial?: Record<string, ManagedProcessState>;
    dropped?: Set<string>;
    blocked?: Record<string, string>;
  } = {},
) {
  let time = 0;
  const processes = new Map<string, ManagedProcessState>(Object.entries(options.initial ?? {}));
  const started: Array<[string, number]> = [];
  const marks = new Map<string, QueueMark | undefined>();
  const markHistory: Array<[string, QueueMark | undefined]> = [];
  const set = (id: string, state: ManagedProcessState) => processes.set(id, state);
  const plan = runStartPlan({
    items,
    targets,
    getProcess: (id) => processes.get(id) ?? { status: "stopped" },
    start: async (id) => {
      started.push([id, time]);
      processes.set(id, running);
    },
    mark: (id, mark) => {
      marks.set(id, mark);
      markHistory.push([id, mark]);
    },
    isDropped: (id) => options.dropped?.has(id) ?? false,
    blockedReason: (id) => options.blocked?.[id],
    upAfterMs: 5000,
    pollMs: 1000,
    now: () => time,
    sleep: async (milliseconds) => {
      time += milliseconds;
      options.events?.(time, set);
    },
  });

  return { plan, started, marks, markHistory, time: () => time };
}

describe("runStartPlan", () => {
  it("starts items that wait for nothing together, right away", async () => {
    const run = simulate([service("a"), service("b")], ["a", "b"]);

    await run.plan.done;

    expect(run.started).toEqual([["a", 0], ["b", 0]]);
  });

  it("does not keep the plan open for items nothing waits for", async () => {
    const run = simulate([service("db"), service("api", "db")], ["api"]);

    await run.plan.done;

    // db had to prove itself for 5s before api started; api itself needed no such wait.
    expect(run.time()).toBe(5000);
    expect(run.started).toEqual([["db", 0], ["api", 5000]]);
  });

  it("starts a service only once the one it waits for has stayed up for five seconds", async () => {
    const run = simulate([service("db"), service("api", "db")], ["db", "api"]);

    await run.plan.firstPass;
    expect(run.started).toEqual([["db", 0]]);
    expect(run.marks.get("api")).toEqual({ status: "waiting", for: ["db"] });

    await run.plan.done;
    expect(run.started).toEqual([["db", 0], ["api", 5000]]);
    expect(run.marks.get("api")).toBeUndefined();
  });

  it("starts what an item waits for even when only the item was asked for", async () => {
    const run = simulate([command("build"), service("db"), service("api", "build"), service("other")], ["api"], {
      events: (time, set) => time >= 2000 && set("build", exited(0)),
    });

    await run.plan.done;

    expect(run.started.map(([id]) => id)).toEqual(["build", "api"]);
    expect(run.started[1]).toEqual(["api", 2000]);
  });

  it("waits for a command to exit with code 0 before starting what follows", async () => {
    const run = simulate([command("build"), service("web", "build")], ["web"], {
      events: (time, set) => time === 3000 && set("build", exited(0)),
    });

    await run.plan.done;

    expect(run.started).toEqual([["build", 0], ["web", 3000]]);
  });

  it("skips what follows a command that failed, and what follows those, saying why", async () => {
    const run = simulate([command("build"), service("api", "build"), service("web", "api")], ["web"], {
      events: (time, set) => time === 1000 && set("build", exited(2)),
    });

    await run.plan.done;

    expect(run.started).toEqual([["build", 0]]);
    expect(run.marks.get("api")).toEqual({ status: "skipped", reason: "build failed" });
    expect(run.marks.get("web")).toEqual({ status: "skipped", reason: "api was skipped" });
  });

  it("skips what follows a service that stopped before it was up", async () => {
    const run = simulate([service("db"), service("api", "db")], ["api"], {
      events: (time, set) => time === 2000 && set("db", exited(1)),
    });

    await run.plan.done;

    expect(run.started).toEqual([["db", 0]]);
    expect(run.marks.get("api")).toEqual({ status: "skipped", reason: "db stopped early" });
  });

  it("does not wait for a service that is already running", async () => {
    const run = simulate([service("db"), service("api", "db")], ["api"], { initial: { db: running } });

    await run.plan.done;

    expect(run.started).toEqual([["api", 0]]);
  });

  it("waits for a command that is already running to finish", async () => {
    const run = simulate([command("build"), service("web", "build")], ["web"], {
      initial: { build: running },
      events: (time, set) => time === 4000 && set("build", exited(0)),
    });

    await run.plan.done;

    expect(run.started).toEqual([["web", 4000]]);
  });

  it("starts an item once all of the things it waits for are ready", async () => {
    const run = simulate([service("db"), service("cache"), service("api", "db", "cache")], ["api"]);

    await run.plan.done;

    expect(run.started).toEqual([["db", 0], ["cache", 0], ["api", 5000]]);
  });

  it("names what an item is still waiting for", async () => {
    const run = simulate([command("build"), service("db"), service("api", "db", "build")], ["api"], {
      events: (time, set) => time === 1000 && set("build", exited(0)),
    });

    await run.plan.firstPass;
    expect(run.marks.get("api")).toEqual({ status: "waiting", for: ["db", "build"] });

    await run.plan.done;
    expect(run.markHistory).toContainEqual(["api", { status: "waiting", for: ["db"] }]);
  });

  it("gives up on an item the user stopped while it waited, and on what waited for it", async () => {
    const dropped = new Set<string>();
    const run = simulate([service("db"), service("api", "db"), service("web", "api")], ["web"], {
      dropped,
      events: (time) => {
        if (time === 1000) {
          dropped.add("api");
        }
      },
    });

    await run.plan.done;

    expect(run.started).toEqual([["db", 0]]);
    expect(run.marks.get("api")).toBeUndefined();
    expect(run.marks.get("web")).toEqual({ status: "skipped", reason: "api was stopped" });
  });

  it("skips an item that cannot be started, saying why, and what waits for it, but not the rest", async () => {
    const run = simulate([service("db"), service("api", "db"), service("web", "api"), service("other")], ["web", "other"], { blocked: { api: "needs STRIPE_KEY" } });

    await run.plan.done;

    expect(run.started.map(([id]) => id).sort()).toEqual(["db", "other"]);
    expect(run.marks.get("api")).toEqual({ status: "skipped", reason: "needs STRIPE_KEY" });
    expect(run.marks.get("web")).toEqual({ status: "skipped", reason: "api was skipped" });
  });

  it("clears an old skipped mark when the plan begins", async () => {
    const run = simulate([service("a")], ["a"]);

    await run.plan.done;

    expect(run.markHistory[0]).toEqual(["a", undefined]);
  });

  it("ignores ids that match no item", async () => {
    const run = simulate([service("a", "ghost")], ["a", "missing"]);

    await run.plan.done;

    expect(run.started).toEqual([["a", 0]]);
  });

  it("gives up on items that wait for each other instead of waiting forever", async () => {
    const run = simulate([service("a", "b"), service("b", "a"), service("c")], ["a", "b", "c"]);

    await run.plan.done;

    expect(run.started).toEqual([["c", 0]]);
    expect(run.marks.get("a")).toEqual({ status: "skipped", reason: "items wait for each other in a loop" });
    expect(run.marks.get("b")).toEqual({ status: "skipped", reason: "items wait for each other in a loop" });
  });

  it("surfaces an error from the plan", async () => {
    const plan = runStartPlan({
      items: [service("a")],
      targets: ["a"],
      getProcess: () => ({ status: "stopped" }),
      start: async () => {
        throw new Error("boom");
      },
      mark: () => undefined,
      isDropped: () => false,
      upAfterMs: 0,
      pollMs: 1,
      now: () => 0,
      sleep: async () => undefined,
    });

    await expect(plan.firstPass).rejects.toThrow("boom");
    await expect(plan.done).rejects.toThrow("boom");
  });
});
