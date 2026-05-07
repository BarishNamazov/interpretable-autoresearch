// Unit tests for data/projection.ts and data/insights.ts.
// Runs under `bun test` (Bun has a Jest-compatible test runner).
import { describe, expect, it } from "bun:test";
import { projectRun } from "../data/projection.ts";
import { deriveInsights } from "../data/insights.ts";
import { parseProgram } from "../data/program.ts";
import { parseEventsStrict } from "../data/parse.ts";
import type { RawEvent } from "../types.ts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..", "..", "..");

function readDomain(d: string): { events: RawEvent[]; programText: string } {
  const events = parseEventsStrict(readFileSync(resolve(REPO, d, "events.jsonl"), "utf-8")).events;
  const programText = readFileSync(resolve(REPO, d, "program.md"), "utf-8");
  return { events, programText };
}

describe("projection", () => {
  it("parses model-training golden log with expected counts", () => {
    const { events, programText } = readDomain("model-training");
    const program = parseProgram(programText);
    const run = projectRun(events, program.actionToReaction);
    expect(run.events.length).toBe(events.length);
    expect(run.hypotheses.length).toBeGreaterThan(0);
    expect(run.experiments.length).toBeGreaterThan(0);
    expect(run.metric.length).toBeGreaterThan(0);
    expect(run.metricKey).toMatch(/val_bpb|primary/);
  });

  it("parses performance-engineering golden log with discovery + profiling", () => {
    const { events, programText } = readDomain("performance-engineering");
    const program = parseProgram(programText);
    const run = projectRun(events, program.actionToReaction);
    expect(run.conceptCounts.Discovering).toBeGreaterThan(0);
    expect(run.conceptCounts.Profiling).toBeGreaterThan(0);
    expect(run.metricDirection).toBe("lower_better");
  });

  it("classifies hypothesis status correctly", () => {
    const events: RawEvent[] = [
      mk("evt-1", "Hypothesizing.formed", {
        description: "raise lr",
        prediction: { direction: "down", magnitude: "~", mechanism: "z" },
      }),
      mk("evt-2", "Experimenting.proposed", { experiment_id: "exp-1", hypothesis_id: "evt-1" }),
      mk("evt-3", "Evaluating.measured", { experiment_id: "exp-1", status: "ok", value: 0.4, metric: "val_bpb" }),
      mk("evt-4", "Experimenting.kept", { experiment_id: "exp-1" }),
    ];
    const run = projectRun(events);
    expect(run.hypotheses[0].status).toBe("confirmed");

    const events2: RawEvent[] = [
      mk("evt-1", "Hypothesizing.formed", {
        description: "drop lr",
        prediction: { direction: "down", magnitude: "~", mechanism: "z" },
      }),
      mk("evt-2", "Experimenting.proposed", { experiment_id: "exp-1", hypothesis_id: "evt-1" }),
      mk("evt-3", "Evaluating.measured", { experiment_id: "exp-1", status: "ok", value: 0.9, metric: "val_bpb" }),
      mk("evt-4", "Experimenting.discarded", { experiment_id: "exp-1" }),
    ];
    expect(projectRun(events2).hypotheses[0].status).toBe("violated");
  });

  it("flags freestyle events", () => {
    const events: RawEvent[] = [
      mk("evt-1", "Freestyling.acted", { reason: "investigating crash" }),
      mk("evt-2", "Hypothesizing.formed", {
        description: "x",
        prediction: { direction: "down", magnitude: "~", mechanism: "z" },
      }),
    ];
    const run = projectRun(events);
    expect(run.freestyles.length).toBe(1);
    expect(run.events[0].isFreestyle).toBe(true);
    expect(run.events[1].isFreestyle).toBe(false);
  });
});

describe("insights", () => {
  it("computes hit rate over confirmed/violated/partial", () => {
    const events: RawEvent[] = [];
    let id = 1;
    function add(action: string, args: Record<string, unknown>) {
      events.push(mk(`evt-${id++}`, action, args));
    }
    function cycle(value: number, kept: boolean) {
      add("Hypothesizing.formed", {
        description: "tune lr",
        prediction: { direction: "down", magnitude: "~", mechanism: "less underfit" },
      });
      const hypId = `evt-${id - 1}`;
      add("Experimenting.proposed", { experiment_id: `exp-${id}`, hypothesis_id: hypId });
      const expId = events[events.length - 1].args["experiment_id"];
      add("Evaluating.measured", { experiment_id: expId, status: "ok", value, metric: "val_bpb" });
      add(kept ? "Experimenting.kept" : "Experimenting.discarded", { experiment_id: expId });
    }
    cycle(0.5, true);
    cycle(0.4, true);
    cycle(0.45, false);
    cycle(0.6, false);
    const run = projectRun(events);
    const ins = deriveInsights(run);
    expect(ins.stats.totalHypotheses).toBe(4);
    expect(ins.stats.confirmed).toBe(2);
    expect(ins.stats.violated).toBe(2);
    expect(ins.stats.hitRate).toBeCloseTo(0.5, 2);
  });
});

function mk(event_id: string, action: string, args: Record<string, unknown>): RawEvent {
  return {
    event_id,
    ts: "2026-01-01T00:00:00.000Z",
    by: "test",
    action,
    args,
    caused_by: [],
  };
}
