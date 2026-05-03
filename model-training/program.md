# Interpretable AutoResearch — Model Training

This is an experiment to have an LLM run an autonomous training-research loop where every step is a deliberate, attributable, replayable event — not an opaque agent log.

The orthodox autoresearch loop appends commits and metrics to a TSV. That's a black box: a future reader sees what happened but not why. Here, your behavior is specified as a small set of **concepts** and **reactions** (in the sense of `reaction_semantics.md`), and your work is recorded as an append-only log of **events** in `events.jsonl`. A separate UI consumes this log to visualize both the metric trajectory and the reaction chain that produced it; you don't have to worry about the UI.

Read this whole document before you do anything. The behavioral code in §3 *is* your loop. The operational instructions in §5–§6 tell you how to actually execute it.

---

## 1. Setup

Work with the user to:

1. **Agree on a run tag** based on today's date (e.g. `mar5`). The branch `autoresearch/<tag>` must not already exist.
2. **Create the branch**: `git checkout -b autoresearch/<tag>` from current master.
3. **Read the in-scope files**:
   - `README.md` — repository context.
   - `prepare.py` — fixed constants, data prep, tokenizer, dataloader, evaluation. Do not modify.
   - `train.py` — the file you modify. Model architecture, optimizer, training loop.
4. **Verify data exists**: check that `~/.cache/autoresearch/` contains data shards and a tokenizer. If not, tell the human to run `uv run prepare.py`.
5. **Initialize `events.jsonl`** as an empty file at the repo root. Do not commit it; leave it untracked.
6. **Confirm and go.** Once confirmed, do not pause to ask permission again.

---

## 2. Event log

Every action you take appends one line to `events.jsonl`. That file is the single source of truth — `results.tsv`, if anyone wants one, is a *projection* over it, not an independently maintained record.

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
- `caused_by` — the event ids that triggered the reaction whose `then` produced this event. This is the provenance chain — the thing that makes the log interpretable. Every event except the very first must have at least one cause.

### 2.2 Attestations vs. requests

Following `reaction_semantics.md`:

- **Attestations** are past-tense actions you make true by emitting them: `Experimenting.kept`, `Hypothesizing.formed`, `Evaluating.measured`. The agent is the seat of the claim.
- **Requests** are calls for something to happen: `request Modifying.apply(...)`. They are emitted as `Requesting.requested` events whose `args` carry the requested action. In this loop you are also the runtime — when you fulfill your own request, you emit the corresponding past-tense attestation, with the request event in its `caused_by`.

A single reaction step typically produces two events: the request (deciding to do it) and the attestation (having done it). Both are recorded. The UI uses this pairing to show "decided to X" → "X happened."

### 2.3 Action payloads

```
Hypothesizing.formed
  args: {
    hypothesis_id, description, reasoning,
    prediction: { direction, magnitude, mechanism, side_effects },
    informed_by_experiment
  }

Modifying.applied
  args: { change_id, to: "train.py", from_hypothesis, summary, diff_brief }
Modifying.reverted
  args: { change_id, restoring: "train.py" }

Experimenting.proposed
  args: { experiment_id, hypothesis_id?, change_id? }
Experimenting.run
  args: { experiment_id, commit_sha, started_at, finished_at }
Experimenting.kept
  args: { experiment_id }
Experimenting.discarded
  args: { experiment_id, reason: "regression" | "crash" }

Evaluating.measured
  args: {
    experiment_id, metric: "val_bpb", value,
    peak_vram_mb, status: "ok" | "crashed", crash_excerpt?
  }

Logging.recorded
  args: {
    experiment_id, commit_sha, val_bpb, memory_gb, status, description,
    outcome_vs_prediction
  }
```

### 2.4 First events

The very first events have empty `caused_by` (they are seeded by the loop start, not by a prior reaction):

1. `Experimenting.proposed` for the baseline (`exp-001`, no hypothesis, no change).
2. The chain proceeds from there.

The baseline is special — it has no hypothesis. Subsequent experiments must each cite a `Hypothesizing.formed` event.

---

## 3. Behavioral code

This is your loop, expressed as concepts and reactions. At each step, look at the tail of `events.jsonl`, identify which reactions' `when` clauses are satisfied by recent events, and execute their `then` clauses.

### 3.1 Concepts

#### `Experimenting`
**Purpose.** The lifecycle of a single training experiment — from proposal through evaluation to a keep-or-discard decision.

**Principle.** A research agent proposes an experiment based on the current best result. The experiment is run, producing a val_bpb score. The agent evaluates the score, decides to keep or discard, and the cycle repeats. Every experiment ever proposed, run, kept, or discarded is in `Experimenting`'s state.

**Actions.** `proposed`, `run`, `kept`, `discarded`.

**State.** All experiments and their dispositions. The current best (most recently kept). Whether any experiment is currently running.

#### `Hypothesizing`
**Purpose.** The lifecycle of forming a research hypothesis — an idea for what change to `train.py` might improve val_bpb.

**Principle.** The agent inspects the current best result and the history of recent experiments. It forms a hypothesis: a brief description of an architectural, optimizer, or hyperparameter change, along with the reasoning and a prediction. Over time, the set of tested hypotheses reveals what worked and what didn't, and what mechanisms were correctly understood.

**Actions.** `formed`, `tested`.

**State.** All formed hypotheses. For each, whether it was tested, by which experiment, and whether that experiment was kept.

#### `Modifying`
**Purpose.** The lifecycle of changing `train.py` to realize a hypothesis, and reverting if the experiment is discarded.

**Principle.** A hypothesis has been formed. The agent applies it as a code change. The change is either committed (if kept) or reverted (if discarded). The history of applied and reverted changes is the file's edit history, traceable back to motivating hypotheses.

**Actions.** `applied`, `reverted`.

**State.** The current applied change. The history of all changes and their disposition. The artifact that is current.

#### `Evaluating`
**Purpose.** Measuring and interpreting the val_bpb metric produced by a training run.

**Principle.** A training run completes. The agent reads the log, extracts val_bpb, records it. It compares against the current best. The comparison drives `Experimenting`'s keep/discard reactions.

**Actions.** `measured`.

**State.** Per experiment: its val_bpb (or `crashed`). The current best across all kept experiments and which experiment achieved it.

#### `Logging`
**Purpose.** Recording an experiment's outcome — including how it compared to its prediction — for human review.

**Principle.** An experiment resolves — kept or discarded. The agent records commit, val_bpb, memory, status, description, and crucially `outcome_vs_prediction`, as a `Logging.recorded` event. `results.tsv` is a projection over these events; it can be regenerated at any time.

**Actions.** `recorded`.

**State.** The full record of logged experiments, in chronological order.

### 3.2 Reactions

Six request; one (R5) attests, because the agent is itself the seat of the "this experiment is kept" claim.

#### R1 — Form a hypothesis after any experiment resolves.

> *After any experiment is resolved (kept or discarded), form a new hypothesis for the next experiment, informed by the current best result.*

```
when:
  Experimenting.kept(?prev) OR Experimenting.discarded(?prev)
where:
  Experimenting: no experiment is currently running
then:
  request Hypothesizing.form(informed_by: ?prev)
```

#### R2 — Apply a change when a hypothesis is formed.

> *When a new hypothesis has been formed, apply it as a code modification to the training script.*

```
when:
  Hypothesizing.formed(?hypothesis)
then:
  request Modifying.apply(?hypothesis, to: train.py)
```

#### R3 — Commit and run after the modification is applied.

> *After a change to the training script is applied, commit it to git and launch the training run.*

```
when:
  Modifying.applied(?change, to: train.py)
where:
  Hypothesizing: ?change originates from ?hypothesis
  Experimenting: ?hypothesis corresponds to ?experiment
then:
  request Committing.commit(?change)
  request Experimenting.run(?experiment)
```

#### R4 — Measure the metric when a run completes.

> *When a training run completes, read the log and record val_bpb for that experiment.*

```
when:
  Experimenting.run(?experiment)
then:
  request Evaluating.measure(val_bpb, for: ?experiment)
```

#### R5 — Keep the experiment if val_bpb improved (attest).

> *When a measurement comes in that is lower than the current best, declare the experiment kept and record the outcome.*

```
when:
  Evaluating.measured(val_bpb, ?value, for: ?experiment)
where:
  Evaluating: current best val_bpb is ?best
  Evaluating: ?value < ?best
then:
  Experimenting.kept(?experiment)
  request Logging.record(?experiment, outcome: keep)
```

`Experimenting.kept` is a **bare attestation** — no external dispatch, true because the agent says so.

#### R6 — Discard and revert if val_bpb did not improve.

> *When a measurement comes in that is not lower than the current best, discard, revert, and record.*

```
when:
  Evaluating.measured(val_bpb, ?value, for: ?experiment)
where:
  Evaluating: current best val_bpb is ?best
  Evaluating: ?value >= ?best
  Experimenting: ?experiment has associated change ?change
then:
  Experimenting.discarded(?experiment)
  request Modifying.revert(?change, restoring: train.py)
  request Logging.record(?experiment, outcome: discard)
```

#### R7 — Record a crash and revert when a run fails.

> *If a run produces no metric (crash or OOM), discard, revert, and record the crash.*

```
when:
  Experimenting.run(?experiment)
where:
  Evaluating: ?experiment has no recorded val_bpb
  Evaluating: ?experiment is marked as crashed
then:
  Experimenting.discarded(?experiment)
  request Modifying.revert(?change, restoring: train.py)
  request Logging.record(?experiment, outcome: crash)
```

R5 and R6 share a `when` and split on `where`, mirroring the keep/discard pattern in `reaction_semantics.md`.

---

## 4. Hypothesis discipline (the interpretability load-bearing part)

The `Hypothesizing.formed` event has four substantive fields: `description`, `reasoning`, `prediction`, `informed_by_experiment`. These are what make the run interpretable. Treat them seriously:

- **`description`** is *what* you propose to change in `train.py`. One sentence, concrete enough that someone reading it could roughly reproduce the diff. "Increase learning rate from 0.02 to 0.04" — yes. "Tune the optimizer" — no.
- **`reasoning`** is *why*, with provenance back to prior events. "Loss curve from exp-007 was clearly underfit; LR is the cheapest knob to address that" — yes. "This often helps" — no. A reasoning that doesn't cite at least one prior observation is too weak; there's nothing for a future reader to learn from.
- **`prediction`** is what you expect *before* running: direction (val_bpb drops), magnitude (~0.003), mechanism (the model was bottlenecked by X and this relaxes X), side effects. This is what makes the eventual `Evaluating.measured` event diagnostic — you can check whether the world matched your model. Retrofitting predictions after the fact defeats the entire point of the log.
- **`informed_by_experiment`** must be a real `event_id` (or null only for the baseline). The chain hinges on this link.

When R5 or R6 fires, the resulting `Logging.recorded` event must include an `outcome_vs_prediction` field — e.g. "matched: dropped 0.0067, predicted ~0.003–0.01" or "violated: predicted drop, observed rise; mechanism hypothesis was wrong because X" or "metric matched but mechanism unclear: speedup may have come from cache effects, not the change I proposed." This single field is what turns the log from a record-of-results into a record-of-learning. **Be honest.** If you were wrong, say so — that is the most useful entry in the log.

---

## 5. Constraints

**What you CAN do:**
- Modify `train.py`. Everything in it is fair game: model architecture, optimizer, hyperparameters, training loop, batch size, model size.

**What you CANNOT do:**
- Modify `prepare.py`. It contains the fixed evaluation, data loading, tokenizer, and training constants (5-minute time budget, sequence length, etc.).
- Install new packages. Use only what's in `pyproject.toml`.
- Modify the evaluation harness. `evaluate_bpb` in `prepare.py` is the ground truth.

**Goal: lowest val_bpb.** Time budget is fixed at 5 minutes; you optimize for what fits in those 5 minutes.

**VRAM** is a soft constraint. Some increase is acceptable for meaningful gains, but it should not blow up dramatically.

**Simplicity criterion**: all else being equal, simpler is better. A 0.001 improvement that adds 20 lines of hacky code? Probably not worth it. A 0.001 improvement from deleting code? Definitely keep. ~0 improvement but much simpler? Keep. Note simplicity-driven keeps explicitly in the `description`.

**The first run** is always the baseline: `train.py` unmodified, no hypothesis attached.

---

## 6. Operational loop

You are the reaction interpreter. At each step:

1. **Tail `events.jsonl`.** Read recent events to know current state. The log is your memory; do not propose anything without consulting it.
2. **Match the next reaction.** Identify which reaction's `when` clause is satisfied by the latest events and whose preconditions in `where` hold. There should usually be exactly one — if more, fire them in order.
3. **Execute the `then` clause.** For each line:
   - **`request` line** → emit a `Requesting.requested` event, perform the work, then emit the corresponding past-tense attestation event with the request in `caused_by`. Concretely:
     - `request Hypothesizing.form` → think it through, emit `Hypothesizing.formed` with all four substantive fields filled out.
     - `request Modifying.apply` → edit `train.py`, emit `Modifying.applied` with a brief summary of what moved.
     - `request Committing.commit` → `git commit -am "<description>"`.
     - `request Experimenting.run` → `uv run train.py > run.log 2>&1` (redirect everything; do NOT `tee` or let raw output flood your context). Emit `Experimenting.run` with start/finish timestamps and commit sha.
     - `request Evaluating.measure` → `grep "^val_bpb:\|^peak_vram_mb:" run.log`. If empty, the run crashed: `tail -n 50 run.log` for the trace, emit `Evaluating.measured` with `status: "crashed"` and a short `crash_excerpt`.
     - `request Modifying.revert` → `git reset --hard HEAD~1`, emit `Modifying.reverted`.
     - `request Logging.record` → emit `Logging.recorded` with all fields including `outcome_vs_prediction`.
   - **Bare attestation** (R5 only) → emit it directly.
4. **Loop.**

A few operational notes the reactions don't capture:

- **Trivial crashes.** If R7's conditions fire and the cause is a typo or import bug, fix it and re-run as the *same* experiment id (don't waste an id on it). If the idea is fundamentally broken, accept the crash, let R7 run, move on.
- **Timeouts.** Each run should take ~5 minutes total. If a run exceeds 10 minutes, kill it and emit `Evaluating.measured` with `status: "crashed"` and `crash_excerpt: "exceeded 10-minute timeout"`.
- **Stuckness.** If you can't think of a hypothesis, **read further back in `events.jsonl`**. Look at hypotheses predicted to work but didn't (mechanism was wrong — what's the right mechanism?), at hypotheses confirmed but only partially exploited, at discarded changes that might combine well with what's now baseline. Re-read the in-scope files for assumptions you've been treating as fixed when they aren't. The structured log makes stuckness diagnosable — use it.

---

## 7. Autonomy

Once the loop has begun, do NOT pause to ask whether to continue. Do NOT ask "should I keep going?" or "is this a good stopping point?" You are autonomous. The human may be asleep or away — they expect you to keep working until manually interrupted.

A user might leave you running while they sleep. At ~5 minutes per experiment that's about 12/hour, ~100 across an average night. The user wakes up to: an `events.jsonl` whose every event traces to its causes, a branch whose every commit is accounted for, and a UI (built separately) that turns both into a legible picture of what was tried, what was predicted, what happened, and what was learned. That is the deliverable.
