# Interpretable Autoresearch

🥈 **2nd Place — Claude @ MIT Spring 2026 Hackathon**

> **"Agents whose behavior you can read, verify, and trust."**

**Track:** Governance & Collaboration — Help people work together better

**Theme:** Human-AI teaming through transparent, auditable behavioral specifications

**Live Deployment**: https://interpretable-autoresearch.pages.dev/

https://github.com/user-attachments/assets/8ac7b13f-bd85-4d9a-bd14-31912feb228a


---

## The problem

AI agents are increasingly taking consequential actions — running experiments, writing code, making autonomous decisions — but their behavior remains opaque. Humans cannot audit what they did, why, or whether it aligned with intent.

Three failures identified by MIT CSAIL:

- **Unintended decisions** — Acting AI systems inevitably diverge from human intent, with no audit trail to diagnose why.
- **No value alignment** — Agents don't inherently understand human values or ethics; behavior is hidden inside prompts and opaque code.
- **Privacy & control risks** — Agents with broad access and no transparent behavioral contract are a security and governance liability.

> Source: MIT CSAIL Alliances — [*"Agentic AI: What you need to know about AI agents"*](https://cap.csail.mit.edu/agentic-ai-what-you-need-know-about-ai-agents)

### Who this affects

Concretely, the people shipping agents *today* are running into this:

- **AI / ML researchers** leaving Karpathy-style autoresearch loops running overnight, waking up to a TSV of metrics and no defensible answer to "why did the agent try this?"
- **Performance & platform engineers** delegating profile-and-optimize work to coding agents, then stuck reviewing 40 commits with no traceable reasoning behind any of them.
- **Engineering teams** adopting coding agents in production codebases, where "the agent wrote this" is not an answer regulators, security reviewers, or future maintainers will accept.
- **Compliance, safety, and governance owners** asked to sign off on autonomous systems whose behavior is specified inside prompts they can't read, version, or audit.

The shared pain: when an autonomous agent does something surprising, nobody — not the operator, not the engineer, not the auditor — can replay *why*. That's the gap this project closes.

---

## Research foundation

We apply **"What You See Is What It Does"** (Meng & Jackson, SPLASH 2025 — [arXiv:2508.14511](https://arxiv.org/abs/2508.14511)), a structural pattern for legible software from MIT CSAIL. The paper proposes two primitives:

**Concepts** — Fully independent services grounded in real-world behavior, not state. Each concept names a lifecycle, exposes actions (past-tense events that have occurred), and derives queryable state from action history. Example: `Reviewing`, `Citing`, `Sharing`.

**Reactions (synchronizations)** — Event-based `when / where / then` rules that mediate between concepts. Each reaction is simultaneously readable prose and executable code. Every agent action is traceable to a specific reaction.

```
when:
  Experimenting.kept(?prev) OR Experimenting.discarded(?prev)
where:
  Experimenting: no experiment is currently running
then:
  request Hypothesizing.form(informed_by: ?prev)


when:
  Hypothesizing.formed(?hypothesis)
then:
  request Modifying.apply(?hypothesis, to: train.py)


when:
  Modifying.applied(?change, to: train.py)
where:
  Hypothesizing: ?change originates from ?hypothesis
  Experimenting: ?hypothesis corresponds to ?experiment
then:
  request Committing.commit(?change)
  request Experimenting.run(?experiment)

... more reactions relevant to researcher's actions
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

## What works today

The repo ships **two end-to-end runnable autoresearch loops** driven by coding agents operating against a behavioral-code `program.md`. Both produce a real, append-only `events.jsonl` you can inspect, replay, and audit.

```
interpretable-autoresearch/
├── harness/                  # pi.dev harness — enforces program.md as a contract
├── ui/                       # three-pane visualisation app
├── model-training/           # autoresearch loop over a small LLM training script
│   ├── program.md
│   ├── hooks.py              #   ← human-owned validators / grounders / observers
│   └── events.jsonl
└── performance-engineering/  # autoresearch loop over a C++ N-body simulator
    ├── program.md
    ├── hooks.py
    └── events.jsonl
```

What you can verify yourself:

- Each loop is bootable in under five minutes (`uv sync` / `make`) and runs an actual baseline experiment on commodity hardware (Apple Silicon Mac or single NVIDIA GPU).
- Each loop emits a typed event per action — `Hypothesizing.formed`, `Modifying.applied`, `Experimenting.run`, `Evaluating.measured`, `Logging.recorded` — with a `caused_by` chain. Open `events.jsonl` and read straight down: every line tells you who did it, what they did, and which earlier event triggered it.
- Each hypothesis records its prediction (`direction`, `magnitude`, `mechanism`, `side_effects`) **before** the experiment runs. Each `Logging.recorded` records `outcome_vs_prediction` **after**. The log is therefore not retrofittable — you cannot quietly rewrite history to look smarter than you were.
- Every keep/revert is a real `git commit` / `git reset --hard HEAD~1` against a branch named `autoresearch/<tag>`. The git history matches the event log.

### Run the harness

The harness is a Python package (`iar-harness`) plus a thin pi.dev extension. The agent only sees four tools — `tail_events`, `next_reactions`, `request`, `attest` — so it cannot freely write to `events.jsonl`. Every event passes through the `hooks.py` you control.

```bash
# Install
cd harness && pip install -e . && cd ..

# Validate the committed event log against your program.md + hooks.py
cd model-training && iar validate --program program.md --events events.jsonl --hooks hooks.py
# → validated 61 events: 0 errors, 0 warnings

cd ../performance-engineering && iar validate --program program.md --events events.jsonl --hooks hooks.py
# → validated 194 events: 0 errors, 4 warnings  (significance ↔ noise-floor mismatches surfaced for review)

# Replay all hooks dry-run:
iar replay --program program.md --events events.jsonl --hooks hooks.py

# Show what the agent is *currently allowed to do* given the log tail:
iar next   --program program.md --events events.jsonl --hooks hooks.py

# Run the live loop driven by pi.dev (requires Node + pi):
iar run    --program program.md --events events.jsonl --hooks hooks.py
```

See [`harness/README.md`](./harness/README.md) for the full hook API (`@validate`, `@ground`, `@on`) and the JSON-RPC protocol the pi extension speaks to.

### Browse the events

```bash
cd ui
bun install
bun run dev
# open http://localhost:3000
```

The UI has shrunk from eight stacked panels to a focused three-pane layout: **metric chart + event stream** on the left, an **inspector** on the right that opens whatever you click. Two persistent tabs (Hypotheses, Insights) summarise what the agent learned. The renderer is concept-driven — it reads `program.md` to know which concepts exist, so adding a third domain requires zero UI code change.

---

## Use cases — what a real user gets out of this

### 1. Karpathy Autoresearch (this repo, `model-training/`)
A researcher leaves an agent running overnight. By morning they have: a branch of attempted experiments, an `events.jsonl` whose every line is a typed event with a `caused_by` cause, and — crucially — a record of which hypotheses *predicted* what and how reality answered. Stuck on a result? Open the log, find the `Hypothesizing.formed` event, read the `prediction.mechanism` field, find the matching `Logging.recorded.outcome_vs_prediction`, see exactly where the agent's mental model diverged from reality.

**Example reaction chain (from `model-training/`):**
```
Experimenting.kept(exp-007) → Hypothesizing.formed(?h, prediction) →
Modifying.applied → Experimenting.run → Evaluating.measured →
Experimenting.kept | Experimenting.discarded → Logging.recorded(outcome_vs_prediction)
```

Each arrow is a separate, readable reaction. Each can be inspected, paused, or overridden by the human, and each event is one line in `events.jsonl` whose `caused_by` points at its trigger.

### 2. Software performance optimization (this repo, `performance-engineering/`)
A platform engineer hands the agent a slow service and a benchmark. Behavioral code makes the agent's reasoning readable: each optimization decision maps to a declared reaction the engineer can review, approve, or reject. The `Discovering` and `Profiling` concepts force the agent to *justify* every change against measured cost attribution — there's no "I felt like rewriting this with SIMD" because the rule says hypotheses cite a recent profile or they don't fire.

---

## Putting humans in control

The whole design point is that humans stay in charge by editing **legible code**, not by guarding a black box.

- **You program the agent in Markdown.** `program.md` is the agent's behavior. Want different behavior? Edit it. No fine-tuning, no prompt-spelunking, no custom harness. The behavioral code is yours, versioned in your git repo, reviewable in PR.
- **The human is a first-class event.** The `Communicating` concept means "the user told the agent X" is recorded as `Communicating.received`, with subsequent reactions citing that event in `caused_by`. Off-record nudges don't exist; if you steered the agent, the log shows it.
- **Pause, override, or revert at any line.** Every modification is a real git commit, every revert is a real `git reset --hard HEAD~1`, every event has an `event_id`. You can stop the loop, edit `program.md`, and resume — the next reaction tail-reads `events.jsonl` and continues.
- **Predictions can't be retroactively edited.** Because `Hypothesizing.formed` is appended *before* the experiment runs, the agent can't quietly rewrite its own predictions to match the outcome. The log is a tamper-evident learning record, not a sanitized PR description.
- **The autonomy is bounded by the program.** Reactions only fire when their `when`/`where` conditions match. The agent has no ambient action — it cannot do something that isn't reachable from a reaction in `program.md`. Restricting agent capability is a code edit, not a prompt patch.

The researcher still owns the research questions, the engineer still owns the design choices, the agent does the legible labor of trying things and writing down why.

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

## Risks we took seriously

We are not claiming this solves agent safety. We are claiming it makes a specific class of agent failures **catchable** instead of invisible. Here is what we wrestled with:

- **Risk: agents lying in the log.** An agent could fabricate a `Hypothesizing.formed.reasoning` field after the fact to match a result that worked.
  *What the design does about it:* events are append-only and timestamped; predictions are required *before* the run; `outcome_vs_prediction` requires the agent to explicitly compare. A retrofitted prediction is detectable in the timestamp ordering and in the `caused_by` chain. Combined with git commit timestamps, the log is replayable evidence.
- **Risk: scope creep / agent touching the wrong files.** A coding agent given shell access can modify anything on disk.
  *What the design does about it:* `Modifying.applied` declares its target file (`to: train.py` for model-training, scoped to `src/` for performance-engineering). The reaction `R3` won't fire on out-of-scope edits, and any out-of-scope change shows up as an unattributed git diff with no `Modifying.applied` event — i.e. the inconsistency is visible to a human reader.
- **Risk: over-trust.** A researcher reads only the metric column of the log and assumes the agent figured something out, when really it stumbled into a noise-floor win or a cache-effect speedup it doesn't understand.
  *What the design does about it:* the `outcome_vs_prediction` field is mandatory and explicitly invites disagreement ("metric matched but mechanism unclear: speedup may have come from cache effects, not the change I proposed"). The performance loop additionally enforces a `significance` flag against a recorded noise floor — sub-noise wins are *required* to be discarded, not kept.
- **Risk: deskilling and displacement.** If agents do all the experimentation, junior researchers and engineers lose the practice that builds expertise.
  *What we believe:* this design is closer to a teaching artifact than a black-box assistant. The `events.jsonl` is exactly the kind of structured lab notebook a junior researcher *should* keep — predictions before outcomes, mechanisms named explicitly, mistakes acknowledged in writing. Reading an agent's log is itself instructive in a way that reading a TSV of metrics is not.
- **Risk: false sense of governance.** "We have an audit log" is not the same as "we have safety."
  *What we are honest about:* the log catches *behavioral* divergence (the agent did something that doesn't trace back to a reaction; the prediction was wrong; the mechanism was wrong). It does **not** prevent prompt-injection, model-level deception, or scenarios where the agent is sandbagging in plausible-looking events. Those require complementary work (sandboxing, capability restriction, alignment evaluations) that this project does not claim to do. What we offer is a structural property that other safety work can build on, not a substitute for it.

---

## References

- Meng, E. & Jackson, D. (2025). *What You See Is What It Does: A Structural Pattern for Legible Software.* Onward! at SPLASH 2025. [arXiv:2508.14511](https://arxiv.org/abs/2508.14511)
- MIT CSAIL Alliances. *Agentic AI: What you need to know about AI agents.* [cap.csail.mit.edu](https://cap.csail.mit.edu/agentic-ai-what-you-need-know-about-ai-agents)
- Karpathy, A. *autoresearch.* [github.com/karpathy/autoresearch](https://github.com/karpathy/autoresearch)

## Appendix

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

**Why the behavioral-code version is better than "agent + TSV".** The agent is not running a free-form "edit, train, log to TSV" loop. It is a reaction interpreter: at each step it tails `events.jsonl`, matches a `when` clause, and fires the corresponding `then`. Every hypothesis carries an explicit prediction; every `Logging.recorded` event carries `outcome_vs_prediction`. The log is a record of *learning*, not just of metrics — and that's exactly what a researcher needs at 8 a.m. when they want to know what the agent figured out overnight.

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
python bench_e2e.py --runs 5                 # establish a baseline + noisefloor
```

Then point an agent at `program.md`. The agent's first reaction (R0) is `Discovering.discover` — it walks `src/`, reads the README, decides whether to use `bench_e2e.py` or write its own harness, and records its codebase map, hot-path hypothesis, and noise floor as a single `Discovering.completed` event. Everything after that cites back to it.

**Why the behavioral-code version is better than "agent + TSV".** Performance work is harder to make interpretable than model training: the bottleneck is unknown, the benchmark may not exist, and finding the *right thing to change* is most of the work. The reactions enforce two disciplines that orthodox loops skip:
- **Profile-grounded hypotheses.** `Hypothesizing.formed` must cite a recent `Profiling.profiled` event and a specific function attribution. No guessing at hot paths.
- **Noise-aware keeps.** `Evaluating.measured` carries a `significance` flag against the noise floor recorded at discovery. A speedup within run-to-run variance is `below_noise_floor` and gets reverted, not kept. (This is the kind of mistake an unsupervised agent will *otherwise* make and accidentally "win" with.)
