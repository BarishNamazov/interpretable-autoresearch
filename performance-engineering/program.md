# Interpretable AutoResearch — Performance Engineering

This is an experiment to have an LLM autonomously improve the performance of a codebase where every step is a deliberate, attributable, replayable event — not an opaque agent log.

The orthodox autoresearch loop appends commits and metrics to a TSV. That's a black box: a future reader sees what happened but not why. Here, your behavior is specified as a small set of **concepts** and **reactions** (in the sense of `reaction_semantics.md`), and your work is recorded as an append-only log of **events** in `events.jsonl`. A separate UI consumes this log to visualize both the metric trajectory and the reaction chain that produced it; you don't have to worry about the UI.

Performance work is harder to make interpretable than model training. Model training has one knob (val_bpb) and a fixed file to edit. Here, the codebase is unknown to you, the bottleneck is unknown to you, and the act of *finding the right thing to change* is most of the work. The behavioral code reflects that: there is a one-shot **`Discovering`** lifecycle at the start, and a recurring **`Profiling`** lifecycle that gates every hypothesis on a recent measurement of where the cost actually lives.

Read this whole document before you do anything. The behavioral code in §3 *is* your loop. The operational instructions in §5–§6 tell you how to actually execute it.

---

## 1. Setup

Work with the user to:

1. **Agree on a run tag** based on today's date (e.g. `mar5`). The branch `autoresearch/<tag>` must not already exist.
2. **Create the branch**: `git checkout -b autoresearch/<tag>` from current master.
3. **Initialize `events.jsonl`** as an empty file at the repo root. Do not commit it; leave it untracked.
4. **Confirm and go.** Once confirmed, do not pause to ask permission again.

Codebase exploration and benchmark setup do not happen here. They happen as the first reaction (R0 — `Discovering`) of the loop, so they appear in the event log like everything else.

---

## 2. Event log

Every action you take appends one line to `events.jsonl`. That file is the single source of truth — `results.tsv`, if anyone wants one, is a *projection* over it.

### 2.1 Schema

```json
{
  "event_id": "evt-00042",
  "ts": "2026-05-03T14:23:11.234Z",
  "by": "autoresearch-mar5",
  "action": "Hypothesizing.formed",
  "args": { ... },
  "caused_by": ["evt-00041"]
}
```

- `event_id` — sequential, zero-padded, never reused.
- `ts` — ISO-8601 UTC.
- `by` — your agent id (use the branch name).
- `action` — `<Concept>.<pastTenseAction>` for attestations, or `Requesting.requested` for requests (see §2.2).
- `args` — action-specific payload (schemas in §2.3).
- `caused_by` — the event ids that triggered the reaction whose `then` produced this event. The provenance chain. Every event except the very first must have at least one cause.

### 2.2 Attestations vs. requests

Same as the model-training program. **Attestations** are past-tense actions you make true by emitting them (`Experimenting.kept`, `Profiling.profiled`, `Discovering.completed`). **Requests** are calls for something to happen, emitted as `Requesting.requested` events whose `args` carry the requested action. A single reaction step typically produces a request and the resulting attestation, both recorded.

### 2.3 Action payloads

```
Discovering.completed
  args: {
    codebase_map: { module_summaries: [...] },
    hot_path_hypothesis: { description, reasoning },
    benchmark: {
      origin: "found" | "wrote",
      path,
      primary_metric: { key, direction: "lower_better" | "higher_better" },
      secondary_metrics: [keys],
      noise_floor: { primary_metric_value_runs: [v1, v2, v3], spread_pct }
    },
    open_questions: [strings]
  }

Profiling.profiled
  args: {
    profile_id, tool: "cProfile" | "py-spy" | "perf" | "manual" | ...,
    target: "benchmark" | "<specific function>",
    hot_attribution: [{ function, percent_of_total }, ...],
    stale_after: experiment_id  // when to invalidate
  }

Hypothesizing.formed
  args: {
    hypothesis_id, description, reasoning,
    prediction: { direction, magnitude, mechanism, side_effects },
    informed_by_experiment, informed_by_profile
  }

Modifying.applied
  args: { change_id, files: [...], from_hypothesis, summary, diff_brief }
Modifying.reverted
  args: { change_id, files: [...] }

Experimenting.proposed
  args: { experiment_id, hypothesis_id?, change_id? }
Experimenting.run
  args: { experiment_id, commit_sha, started_at, finished_at }
Experimenting.kept
  args: { experiment_id }
Experimenting.discarded
  args: { experiment_id, reason: "regression" | "crash" | "tests_failed" | "below_noise_floor" }

Evaluating.measured
  args: {
    experiment_id, primary: { key, value }, secondary: [{ key, value }],
    status: "ok" | "crashed" | "tests_failed", crash_excerpt?,
    significance: "above_noise" | "below_noise"
  }

Logging.recorded
  args: {
    experiment_id, commit_sha, primary_value, secondary_value,
    status, description, outcome_vs_prediction
  }
```

### 2.4 First events

The first event is `Requesting.requested` for `Discovering.discover`, with empty `caused_by`. The agent then executes discovery and emits `Discovering.completed`. The baseline experiment chain begins from there.

---

## 3. Behavioral code

This is your loop, expressed as concepts and reactions. At each step, look at the tail of `events.jsonl`, identify which reactions' `when` clauses are satisfied, and execute their `then` clauses.

### 3.1 Concepts

#### `Discovering` *(one-shot)*
**Purpose.** The lifecycle of mapping the codebase, identifying its hot path, and locating or creating an end-to-end benchmark before any experiments begin.

**Principle.** A research agent enters an unfamiliar repository. It walks `src/`, identifies entry points and the realistic data path, looks for an existing benchmark suitable for end-to-end measurement, and either uses it or writes one. It runs the benchmark a few times to establish a noise floor. The result of this process is a `Discovering.completed` event whose payload — the codebase map, hot-path hypothesis, benchmark choice, noise floor, and open questions — anchors everything that follows.

**Actions.** `completed`.

**State.** Whether discovery has completed. The codebase map, hot-path hypothesis, chosen benchmark, primary and secondary metrics, and noise floor as recorded at discovery time. The list of open questions raised during discovery.

#### `Profiling`
**Purpose.** Measuring where execution cost lives, so that hypotheses are grounded in observation rather than guesswork.

**Principle.** Before forming a hypothesis about *where* to optimize, the agent profiles the benchmark and attributes cost to specific functions. Profiles are referenced by later `Hypothesizing.formed` events. A profile becomes stale when the code changes meaningfully; the agent can invalidate and re-profile at any time. Every change should trace back to an attribution in some recent profile.

**Actions.** `profiled`.

**State.** All profiles taken, with their tool, target, attribution map, and which experiment marked them stale (if any). The most recent valid profile.

#### `Experimenting`
**Purpose.** The lifecycle of a single performance experiment — from proposal through evaluation to a keep-or-discard decision.

**Principle.** A research agent proposes an experiment based on the current best result and a recent profile. The experiment is run as one execution of the end-to-end benchmark, producing a primary metric value. The agent evaluates against the current best (and against the noise floor), decides keep or discard, and the cycle repeats.

**Actions.** `proposed`, `run`, `kept`, `discarded`.

**State.** All experiments and their dispositions. The current best (most recently kept). Whether any experiment is currently running.

#### `Hypothesizing`
**Purpose.** The lifecycle of forming a research hypothesis — an idea for what change to the codebase might improve the primary metric.

**Principle.** The agent inspects the current best result, the most recent profile, and the history of recent experiments. It forms a hypothesis: a brief description of a code change tied to a specific function or hot path, along with reasoning and a prediction. Over time, the set of tested hypotheses reveals what worked, what didn't, and where the agent's mental model of the codebase was right or wrong.

**Actions.** `formed`, `tested`.

**State.** All formed hypotheses. For each: whether it was tested, by which experiment, whether kept, and whether the predicted mechanism matched reality.

#### `Modifying`
**Purpose.** The lifecycle of changing source files to realize a hypothesis, and reverting if the experiment is discarded.

**Principle.** A hypothesis has been formed. The agent applies it as a code change — possibly across multiple files in `src/`. The change is committed (if kept) or reverted (if discarded). The history is traceable back to motivating hypotheses and profiles.

**Actions.** `applied`, `reverted`.

**State.** The current applied change. The history of all changes and their disposition.

#### `Evaluating`
**Purpose.** Running the end-to-end benchmark and interpreting its primary and secondary metrics, including comparison against the noise floor.

**Principle.** A benchmark run completes. The agent reads the log, extracts the primary and secondary metrics, and records them along with a `significance` flag (above or below the noise floor recorded at discovery). Wins below the noise floor are not wins.

**Actions.** `measured`.

**State.** Per experiment: primary and secondary metric values, run status, significance flag. The current best primary value across all kept experiments.

#### `Logging`
**Purpose.** Recording an experiment's outcome — including how it compared to its prediction — for human review.

**Principle.** An experiment resolves. The agent records commit, metrics, status, description, and crucially `outcome_vs_prediction`, as a `Logging.recorded` event. Any downstream tabular view is a projection over these events.

**Actions.** `recorded`.

**State.** The full record of logged experiments, in chronological order.

### 3.2 Reactions

Discovery (R0) is one-shot. Then the loop runs R1–R8. R6 attests; the rest request.

#### R0 — Discover the codebase before anything else.

> *Before any experiments, walk the codebase, locate or write the end-to-end benchmark, and establish a noise floor.*

```
when:
  events.jsonl is empty (or contains only the seed Requesting.requested for Discovering)
then:
  request Discovering.discover()
```

#### R1 — Profile after discovery completes, or after several experiments since the last profile.

> *After discovery completes, take an initial profile. Re-profile whenever recent changes may have shifted the hot path.*

```
when:
  Discovering.completed(?discovery)
  OR Experimenting.kept(?prev) AND profile is stale
then:
  request Profiling.profile(target: benchmark)
```

A profile becomes stale after a configurable number of kept experiments (default: 3) or when the agent judges (and notes in `Hypothesizing.reasoning`) that the hot path has shifted.

#### R2 — Form a hypothesis after a profile completes, or after any experiment resolves.

> *After a fresh profile, or after any experiment resolves, form a new hypothesis grounded in the most recent profile and the current best result.*

```
when:
  Profiling.profiled(?profile)
  OR Experimenting.kept(?prev) OR Experimenting.discarded(?prev)
where:
  Experimenting: no experiment is currently running
  Profiling: most recent valid profile is ?profile
then:
  request Hypothesizing.form(informed_by_profile: ?profile, informed_by_experiment: ?prev)
```

#### R3 — Apply a change when a hypothesis is formed.

> *When a new hypothesis has been formed, apply it as a code modification.*

```
when:
  Hypothesizing.formed(?hypothesis)
then:
  request Modifying.apply(?hypothesis, to: src/)
```

#### R4 — Commit and run after the modification is applied.

> *After a code change is applied, commit it to git and launch the benchmark.*

```
when:
  Modifying.applied(?change)
where:
  Hypothesizing: ?change originates from ?hypothesis
  Experimenting: ?hypothesis corresponds to ?experiment
then:
  request Committing.commit(?change)
  request Experimenting.run(?experiment)
```

#### R5 — Measure the metric when a run completes.

> *When a benchmark run completes, read the log and record primary and secondary metrics for that experiment.*

```
when:
  Experimenting.run(?experiment)
then:
  request Evaluating.measure(for: ?experiment)
```

#### R6 — Keep the experiment if the primary metric improved above the noise floor (attest).

> *When a measurement comes in that beats the current best by more than the noise floor, declare the experiment kept and record the outcome.*

```
when:
  Evaluating.measured(?primary, for: ?experiment)
where:
  Evaluating: current best primary metric is ?best
  Evaluating: ?primary improves on ?best by more than the noise floor
  Evaluating: tests pass
then:
  Experimenting.kept(?experiment)
  request Logging.record(?experiment, outcome: keep)
```

`Experimenting.kept` is a **bare attestation** — no external dispatch, true because the agent says so.

The "tests pass" condition is enforced by the runtime: if `src/` has a test suite, run it after non-trivial changes. A run that improves the metric but breaks tests is a `tests_failed` crash, not a keep.

#### R7 — Discard and revert if the metric did not meaningfully improve.

> *When a measurement comes in that does not beat the current best by more than the noise floor, discard, revert, and record.*

```
when:
  Evaluating.measured(?primary, for: ?experiment)
where:
  Evaluating: current best primary metric is ?best
  Evaluating: ?primary does not improve on ?best by more than the noise floor
  Experimenting: ?experiment has associated change ?change
then:
  Experimenting.discarded(?experiment, reason: "regression" or "below_noise_floor")
  request Modifying.revert(?change)
  request Logging.record(?experiment, outcome: discard)
```

#### R8 — Record a crash and revert when a run fails or tests fail.

> *If a run produces no metric, or tests fail, discard, revert, and record.*

```
when:
  Experimenting.run(?experiment)
where:
  Evaluating: ?experiment is marked crashed OR tests_failed
then:
  Experimenting.discarded(?experiment, reason: "crash" or "tests_failed")
  request Modifying.revert(?change)
  request Logging.record(?experiment, outcome: crash)
```

R6 and R7 share a `when` and split on `where`, mirroring the keep/discard pattern in `reaction_semantics.md`. The "above noise floor" condition is the perf-engineering twist: a numerical improvement that is within run-to-run variance is not actually a win, and treating it as one is exactly the kind of mistake the structured log is meant to prevent.

---

## 4. Hypothesis discipline (the interpretability load-bearing part)

The `Hypothesizing.formed` event has five substantive fields: `description`, `reasoning`, `prediction`, `informed_by_profile`, `informed_by_experiment`. These are what make the run interpretable. Treat them seriously:

- **`description`** is *what* you propose to change. One sentence, concrete enough that someone reading it could roughly reproduce the diff. "Reuse a single buffer in `tokenize_batch` instead of allocating a fresh list per call" — yes. "Optimize tokenization" — no.
- **`reasoning`** is *why*, with provenance. **It must cite a function from the most recent profile** ("`tokenize_batch` is 38% of total time per the most recent profile, and the per-call list allocation is the line-by-line attribution"). A reasoning that doesn't tie back to a profile attribution is too weak — you're guessing at where the cost lives instead of measuring.
- **`prediction`** is what you expect *before* running: direction, magnitude, mechanism, side effects. Be specific enough that the result can disagree with you. "Primary metric drops ~10–15% because we eliminate ~N allocations per iteration; peak memory rises slightly because the buffer is held across calls."
- **`informed_by_profile`** must be a real `Profiling.profiled` `event_id`. If you skipped re-profiling (because the previous profile is still current), the field still points to that previous profile's event id and the `reasoning` says "previous profile is still current because the last few changes didn't touch the hot path."
- **`informed_by_experiment`** is the prior experiment whose resolution motivated this hypothesis.

When R6 or R7 fires, the resulting `Logging.recorded` event must include an `outcome_vs_prediction` field — e.g. "matched: dropped 12%, predicted ~10–15%, mechanism confirmed by follow-up profile" or "violated: predicted drop, observed below-noise change; the function I targeted wasn't actually the bottleneck I thought it was — see profile evt-00031 for re-attribution" or "metric matched but mechanism unclear: speedup may have come from cache effects, not from the change I proposed."

**A common trap to call out.** The metric improves but for a *different reason* than you predicted. If you predicted "fewer allocations" but the speedup actually came from cache locality you didn't anticipate, the keep is weaker — your map of the codebase is still wrong, and you'll mispredict next time. Call this out explicitly in `outcome_vs_prediction`. The next reader of the log needs to know.

---

## 5. Constraints

**What you CAN do:**
- Modify any code under `src/`. Refactor, rewrite hot paths, change algorithms, add caching, swap data structures, vectorize, parallelize.
- Modify the benchmark **only** to fix bugs in measurement (e.g. you discover the warm-up is too short). Document any such change as a special `Logging.recorded` with `status: "meta"` and re-establish the noise floor as the next experiment.

**What you CANNOT do:**
- Change the primary metric or its semantics after `Discovering.completed` is emitted. Once chosen at discovery, the metric is fixed for the run. (If the metric turns out to be deeply wrong, stop the loop and surface that to the human — do not silently switch.)
- Install new packages or dependencies. You can only use what's already in the project's manifest.
- Change the public API of `src/` modules in ways that would break callers, unless `Discovering.completed` recorded that no external callers exist.

**Goal: improve the primary metric.** If lower-is-better, drive it down; if higher-is-better, drive it up. The benchmark is the ground truth.

**Memory is a soft constraint.** Some increase is acceptable for meaningful gains, but not 10x for a 2x speedup.

**Correctness is hard.** If `src/` has a test suite, run it after non-trivial changes. Test failures count as crashes (R8).

**Simplicity criterion**: all else being equal, simpler is better. A 5% speedup that adds 200 lines of manual SIMD is rarely worth a 4% speedup from a clean refactor. A neutral-perf change that *cleans up* the hot path so future changes are easier is worth keeping; note that motivation explicitly in `description` and `outcome_vs_prediction`.

**The first run** after `Discovering.completed` is always the baseline: code unmodified, no hypothesis attached.

---

## 6. Operational loop

You are the reaction interpreter. At each step:

1. **Tail `events.jsonl`.** Read recent events to know current state. The log is your memory.
2. **Match the next reaction.** Identify which reaction's `when` clause is satisfied by the latest events and whose preconditions in `where` hold. There should usually be exactly one — if more, fire them in order.
3. **Execute the `then` clause.** For each line:
   - **`request` line** → emit a `Requesting.requested` event, perform the work, then emit the corresponding past-tense attestation event with the request in `caused_by`. Concretely:
     - `request Discovering.discover` → walk `README.md` and `src/` recursively. Look for entry points, the realistic data path, existing benchmarks. If a suitable benchmark exists, use it; if not, write `bench_e2e.py` (or language-appropriate equivalent) that exercises a realistic path, prints results in flat-key format (`primary_metric_key: value`), and supports a fixed-iterations median or trimmed mean. Run it 3 times unmodified to get a noise floor. Emit `Discovering.completed` with the full payload.
     - `request Profiling.profile` → run `cProfile` / `py-spy` / `perf` / equivalent on the benchmark. Cite specific functions and percentages. Emit `Profiling.profiled` with the attribution.
     - `request Hypothesizing.form` → think it through, emit `Hypothesizing.formed` with all five substantive fields filled out.
     - `request Modifying.apply` → edit code under `src/`. If the change is non-trivial, run the test suite (`pytest`, `cargo test`, etc.) before benchmarking; failures here go straight to R8 without running the benchmark. Emit `Modifying.applied`.
     - `request Committing.commit` → `git commit -am "<description>"`.
     - `request Experimenting.run` → run the benchmark, redirecting all output: `<runner> bench_e2e.py > run.log 2>&1` (do NOT `tee`; do NOT let raw output flood your context). Emit `Experimenting.run`.
     - `request Evaluating.measure` → grep for the primary and secondary metric keys recorded in `Discovering.completed`. Compute `significance` against the noise floor. If the run failed, `tail -n 50 run.log`, emit `Evaluating.measured` with `status: "crashed"` and a short `crash_excerpt`. If tests failed, `status: "tests_failed"`.
     - `request Modifying.revert` → `git reset --hard HEAD~1`, emit `Modifying.reverted`.
     - `request Logging.record` → emit `Logging.recorded` with all fields including `outcome_vs_prediction`.
   - **Bare attestation** (R6 only) → emit it directly.
4. **Loop.**

Operational notes the reactions don't capture:

- **Trivial crashes.** If R8 fires due to a typo or import bug, fix and re-run as the *same* experiment id. If the idea is fundamentally broken, accept the crash, let R8 run, move on.
- **Timeouts.** A benchmark run should take roughly the time `Discovering.completed` recorded. If a run takes more than 3x that, kill it and emit `Evaluating.measured` with `status: "crashed"` and `crash_excerpt: "exceeded 3x baseline timeout"`.
- **Profile staleness.** If the most recent profile is more than ~3 kept experiments old, or you suspect the hot path has shifted, re-profile (R1's second branch fires). Cheap profiles run often are better than stale profiles.
- **Stuckness.** **Read further back in `events.jsonl`.** Especially the open questions from `Discovering.completed` — those are usually still live. Re-profile; the hot path may have shifted. Look at hypotheses confirmed but only partially exploited. Look at discarded changes that might combine with what's now baseline. If nothing surfaces, consider more invasive refactors flagged as "scary but plausible" in the discovery payload. The structured log makes stuckness diagnosable — use it.

---

## 7. Autonomy

Once the loop has begun, do NOT pause to ask whether to continue. Do NOT ask "should I keep going?" or "is this a good stopping point?" You are autonomous. The human may be asleep or away — they expect you to keep working until manually interrupted.

A user might leave you running for hours. They wake up to: an `events.jsonl` whose every event traces to its causes (discovery → profile → hypothesis → change → run → measurement → keep-or-discard, with predictions checked against outcomes), a branch whose every commit is accounted for, and a UI (built separately) that turns both into a legible picture of what was tried, what the profile said, what was predicted, what happened, and what was learned. That is the deliverable.
