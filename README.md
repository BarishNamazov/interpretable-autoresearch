# Interpretable Autoresearch

*Built for **Claude @ MIT Hackathon**.*

> **"Agents whose behavior you can read, verify, and trust."**

**Track:** Governance & Collaboration — Help people work together better
**Theme:** Human-AI teaming through transparent, auditable behavioral specifications

---

## The problem

AI agents are increasingly taking consequential actions — running experiments, writing code, making autonomous decisions — but their behavior remains opaque. Humans cannot audit what they did, why, or whether it aligned with intent.

Three failures identified by MIT CSAIL:

- **Unintended decisions** — Acting AI systems inevitably diverge from human intent, with no audit trail to diagnose why.
- **No value alignment** — Agents don't inherently understand human values or ethics; behavior is hidden inside prompts and opaque code.
- **Privacy & control risks** — Agents with broad access and no transparent behavioral contract are a security and governance liability.

> Source: MIT CSAIL Alliances — [*"Agentic AI: What you need to know about AI agents"*](https://cap.csail.mit.edu/agentic-ai-what-you-need-know-about-ai-agents)

---

## Research foundation

We apply **"What You See Is What It Does"** (Meng & Jackson, SPLASH 2025 — [arXiv:2508.14511](https://arxiv.org/abs/2508.14511)), a structural pattern for legible software from MIT CSAIL. The paper proposes two primitives:

**Concepts** — Fully independent services grounded in real-world behavior, not state. Each concept names a lifecycle, exposes actions (past-tense events that have occurred), and derives queryable state from action history. Example: `Reviewing`, `Citing`, `Sharing`.

**Reactions (synchronizations)** — Event-based `when / where / then` rules that mediate between concepts. Each reaction is simultaneously readable prose and executable code. Every agent action is traceable to a specific reaction.

```
when:
  Sharing.shared(?artifact, to: ?me)
where:
  Authoring: ?artifact is a paper draft with author ?author
  Mentoring: ?author is advised by ?me
then:
  request Reviewing.start(?artifact)
```

This gives us a domain-specific language where behavioral features are granular, declarative, and human-readable — and readily generated or verified by an LLM.

---

## Our solution: behavioral code as the collaboration layer

Every agent — human, research group, or LLM tool — is described by **behavioral code**: a set of reactions over shared concepts. This creates a legible, auditable contract for every action the agent takes.

### How it works

**Step 1 — Human describes intent casually**
> "Review my students' paper drafts and email me a summary."
No prompts. No code. No system engineering.

**Step 2 — System interprets into behavioral code**
Each reaction carries both prose (for humans) and formal DSL (for execution). Any action is traceable to a specific reaction and its author.

**Step 3 — Agent is deployed and stays legible**
Humans can read, modify, or audit the behavioral code at any time. When behavior should change, the code changes — not hidden prompts.

### The trust mechanism

Provenance is built in: every action carries a `by` field identifying which agent made the claim. Other agents verify by inspecting who attested what — no global authority required, no black box.

```
Acting.acted(action: Reviewing.completed, by: <agent>, args: { artifact: ?artifact })
```

---

## What's in this repo

This repository contains two concrete instantiations of the behavioral-code pattern, each a self-contained autoresearch loop where an LLM agent drives experimentation under a `program.md` written in the concept/reaction DSL. Each subdirectory is independently runnable; they share no code, only the underlying pattern.

```
interpretable-autoresearch/
├── model-training/           # autoresearch loop over a small LLM training script
└── performance-engineering/  # autoresearch loop over a C++ N-body simulator
```

Both loops emit an append-only `events.jsonl` whose every line is a typed, causally-linked event. A separate UI (out of scope for this repo) consumes that log to render the metric trajectory and the reaction chain that produced it.

### `model-training/` — Karpathy-style LLM autoresearch

A simplified single-GPU LLM training setup (a fork of Karpathy's [`nanochat`](https://github.com/karpathy/nanochat) lineage, with macOS / Apple Silicon MPS support added) wrapped in a behavioral-code program. The agent is handed `train.py` and a fixed wall-clock training budget, and it iterates: form a hypothesis about the model/optimizer, modify `train.py`, train, evaluate `val_bpb`, keep or revert, log the outcome against its prediction. Repeat overnight.

**Layout**

- `program.md` — the agent's instructions, expressed as concepts (`Experimenting`, `Hypothesizing`, `Modifying`, `Evaluating`, `Logging`, `Communicating`) and reactions R1–R7. This is the file a human edits to change agent behavior.
- `prepare.py` — fixed constants, data download, tokenizer training, dataloader, evaluation harness. **Not modified by the agent.** `TIME_BUDGET` lives here (currently 30 s for fast prototyping; upstream uses 300 s).
- `train.py` — single-file GPT model + Muon/AdamW optimizer + training loop. **The only file the agent edits.**
- `events.jsonl` — append-only event log produced by the agent (untracked, regenerated per run).
- `run.log` — most recent `uv run train.py` output, used by the agent to extract `val_bpb` and detect crashes.
- `analysis.ipynb`, `progress.png` — human-side inspection of the run.
- `original/` — upstream-style reference `program.md` (5-minute budget, free-form loop), kept for diff against the behavioral-code version.
- `CHANGES.md` — notes on the local prototype delta vs. upstream (time budget, behavioral-code framing, MPS support).

**Quick start** (Apple Silicon Mac or single NVIDIA GPU; Python 3.10+; [`uv`](https://docs.astral.sh/uv/))

```bash
cd model-training
uv sync
uv run prepare.py        # one-time data + tokenizer prep, ~2 min
uv run train.py          # one manual baseline experiment, ~30 s + startup/eval
```

Then point a coding agent (Claude / Codex / etc.) at `program.md` and let it run autonomously. See `model-training/README.md` for full details.

**The behavioral-code delta.** The agent is not running a free-form "edit, train, log to TSV" loop. It is a reaction interpreter: at each step it tails `events.jsonl`, matches a `when` clause, and fires the corresponding `then`. Every hypothesis carries an explicit prediction (direction, magnitude, mechanism, side effects); every `Logging.recorded` event carries `outcome_vs_prediction`. The log is a record of *learning*, not just of metrics.

### `performance-engineering/` — autoresearch over a C++ codebase

A deliberately unoptimized 3-D gravitational N-body simulator (`src/nbody.cpp`: O(N²) pairwise forces, AoS layout, no Newton's third law, single-threaded) plus an end-to-end benchmark harness. The agent is dropped into the repo cold: it must first **discover** the codebase, write or adopt a benchmark, establish a noise floor, then loop on profile → hypothesize → modify → measure → keep-or-discard.

**Layout**

- `program.md` — agent instructions over concepts `Discovering`, `Profiling`, `Experimenting`, `Hypothesizing`, `Modifying`, `Evaluating`, `Logging`, `Communicating` and reactions R0–R8. Notable additions vs. model-training: a one-shot `Discovering` reaction at the start, and a `Profiling` lifecycle that gates every hypothesis on a recent measurement.
- `bench_e2e.py` — Python harness that builds and runs `src/nbody`, computes a median wall-clock time over N runs, and verifies a position-weighted `checksum` against the baseline as a correctness anchor. Prints flat `key: value` lines for the agent's `Evaluating.measure` step.
- `events.jsonl` — append-only event log.
- `src/`
  - `nbody.cpp` — the C++ simulator. Fair game for the agent: algorithms, data layout, vectorization, parallelization.
  - `Makefile` — `-O3 -std=c++17 -march=native -fopenmp`. Builds `./nbody`.
  - `visualize.py` — matplotlib trajectory viewer for human sanity checks; depends on the `-dump` binary format (changing the format requires updating this file).
  - `README.md` — full description of the simulator, CLI, output format, and the contract the agent must preserve (checksum semantics, CLI flags, `make` target).

**Quick start**

```bash
cd performance-engineering
make -C src                                  # build ./src/nbody
python bench_e2e.py --runs 5                 # establish a baseline + noise floor
```

Then point an agent at `program.md`. The agent's first reaction (R0) is `Discovering.discover` — it walks `src/`, reads the README, decides whether to use `bench_e2e.py` or write its own harness, and records its codebase map, hot-path hypothesis, and noise floor as a single `Discovering.completed` event. Everything after that cites back to it.

**The behavioral-code delta.** Performance work is harder to make interpretable than model training: the bottleneck is unknown, the benchmark may not exist, and finding the *right thing to change* is most of the work. The reactions enforce two disciplines that orthodox "agent + TSV" loops skip:
- **Profile-grounded hypotheses.** `Hypothesizing.formed` must cite a recent `Profiling.profiled` event and a specific function attribution. No guessing at hot paths.
- **Noise-aware keeps.** `Evaluating.measured` carries a `significance` flag against the noise floor recorded at discovery. A speedup within run-to-run variance is `below_noise_floor` and gets reverted, not kept.

---

## Use cases

### 1. Karpathy Autoresearch (this repo, `model-training/`)
Agents autonomously run literature reviews, training experiments, extract claims, check sources, and synthesize findings. With behavioral code, every research step — read, extract, modify, train, evaluate, keep-or-revert — is a traceable, human-auditable reaction. Researchers can inspect exactly what the agent did and why, and override any step.

**Example reaction chain (from `model-training/`):**
```
Experimenting.kept(exp-007) → Hypothesizing.formed(?h, prediction) →
Modifying.applied → Experimenting.run → Evaluating.measured →
Experimenting.kept | Experimenting.discarded → Logging.recorded(outcome_vs_prediction)
```

Each arrow is a separate, readable reaction. Each can be inspected, paused, or overridden by the human, and each event is one line in `events.jsonl` whose `caused_by` points at its trigger.

### 2. Software performance optimization (this repo, `performance-engineering/`)
Agents profile, identify bottlenecks, and apply optimizations. Behavioral code makes the agent's reasoning readable: each optimization decision maps to a declared reaction that a developer can review, approve, or reject — human in the loop by design, not by accident. The `Discovering` and `Profiling` concepts force the agent to *justify* every change against measured cost attribution, not against a guess.

---

## Why this matters for governance & collaboration

This project addresses the core governance challenge of agentic AI: **accountability**. Most approaches treat human oversight as a feature bolted on after deployment. We treat it as a structural property of the language itself.

- Agents cannot act outside their behavioral code — there is no ambient action.
- Every action is attributable to a specific reaction authored by a specific agent (`by: autoresearch-<tag>`), with a `caused_by` chain back to its trigger.
- Modifying agent behavior requires changing legible, versioned code (`program.md`) — not hunting through prompts.
- Multiple agents collaborate through shared concepts, making the interface between them readable to humans.
- Predictions are recorded *before* outcomes (`Hypothesizing.formed.prediction`) and explicitly compared *after* (`Logging.recorded.outcome_vs_prediction`), so the log captures mechanism understanding, not only metric deltas.

This directly enables the kind of human-AI collaboration where trust is earned incrementally and verified continuously — not assumed.

---

## References

- Meng, E. & Jackson, D. (2025). *What You See Is What It Does: A Structural Pattern for Legible Software.* Onward! at SPLASH 2025. [arXiv:2508.14511](https://arxiv.org/abs/2508.14511)
- MIT CSAIL Alliances. *Agentic AI: What you need to know about AI agents.* [cap.csail.mit.edu](https://cap.csail.mit.edu/agentic-ai-what-you-need-know-about-ai-agents)
- Karpathy, A. *autoresearch.* [github.com/karpathy/autoresearch](https://github.com/karpathy/autoresearch)
