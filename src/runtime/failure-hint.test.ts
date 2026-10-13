import { describe, expect, it } from "vitest";
import type { ManagedProcessState, ServiceLogEntry } from "../process/process-manager.js";
import { explainFailure } from "./failure-hint.js";
import type { RuntimeItemState } from "./runtime-state.js";

const log = (line: string, stream: ServiceLogEntry["stream"] = "stderr"): ServiceLogEntry => ({ stream, line, timestamp: new Date(0) });

function stateOf(process: ManagedProcessState, fromProject: string | null = "api"): RuntimeItemState {
  return {
    item: { kind: "service", id: "svc_api", name: "api", command: "pnpm dev", cwd: "/x", autoStart: true, env: {}, after: [], ...(fromProject === null ? {} : { fromProject }) },
    process,
  };
}

const exited = (exitCode: number | null, signal: NodeJS.Signals | null = null): ManagedProcessState => ({ status: "exited", exitCode, signal });

describe("explainFailure", () => {
  it("says nothing for items made on this machine, or that are fine", () => {
    expect(explainFailure(stateOf(exited(1), null), [])).toBeUndefined();
    expect(explainFailure(stateOf({ status: "running", pid: 1 }), [])).toBeUndefined();
    expect(explainFailure(stateOf({ status: "stopped" }), [])).toBeUndefined();
    expect(explainFailure(stateOf(exited(0)), [])).toBeUndefined();
    expect(explainFailure(undefined, [])).toBeUndefined();
  });

  it("does not blame the project file for an item that was stopped by a signal", () => {
    expect(explainFailure(stateOf(exited(null, "SIGTERM")), [])).toBeUndefined();
  });

  it("explains a missing working folder", () => {
    const hint = explainFailure(stateOf({ status: "failed", error: new Error("working folder not found: /home/other/app") }), []);

    expect(hint).toBe("Its folder isn't on this machine. Press e to change it, only for you.");
  });

  it("names a program that is not installed, as shells and Windows report it", () => {
    expect(explainFailure(stateOf(exited(127)), [log("/bin/sh: 1: pnpm: not found")])).toContain('"pnpm" isn\'t installed here');
    expect(explainFailure(stateOf(exited(127)), [log("bash: docker: command not found")])).toContain('"docker" isn\'t installed here');
    expect(explainFailure(stateOf(exited(1)), [log("'yarn' is not recognized as an internal or external command,")])).toContain('"yarn" isn\'t installed here');
  });

  it("still says a program is missing when only the exit code 127 shows it", () => {
    expect(explainFailure(stateOf(exited(127)), [log("something unreadable")])).toContain("A program it runs isn't installed here");
  });

  it("explains a port that is already taken", () => {
    expect(explainFailure(stateOf(exited(1)), [log("Error: listen EADDRINUSE: address already in use :::3000")]))
      .toBe("A port it needs is already in use here. Free it, or press e to use another port, only for you.");
    expect(explainFailure(stateOf(exited(1)), [log("Port 3000 is already in use")])).toContain("port it needs is already in use");
  });

  it("falls back to a general hint that points at the logs and the edit key", () => {
    const hint = explainFailure(stateOf(exited(2)), [log("boom")]);

    expect(hint).toContain("From sable.json");
    expect(hint).toContain("Read the logs (Enter) or press e");
  });

  it("only looks at recent output", () => {
    const old = [log("pnpm: not found"), ...Array.from({ length: 100 }, () => log("fine"))];

    expect(explainFailure(stateOf(exited(1)), old)).toContain("From sable.json");
  });

  it("explains a service that failed to start at all", () => {
    expect(explainFailure(stateOf({ status: "failed", error: new Error("spawn EACCES") }), [])).toContain("From sable.json");
  });
});
