# Local changes (time budget prototype)

## Training time budget: 5 minutes → 30 seconds

- **`prepare.py`:** `TIME_BUDGET` is set to **30** seconds for fast local prototyping. The production-style default in the autoresearch pattern is **300** seconds (5 minutes).
- **`train.py`:** Muon momentum schedule no longer assumes a fixed **300-step** warmup curve (which loosely matched an old 5-minute run). `get_muon_momentum` now uses the same **`progress`** as the LR schedules (`training_time / TIME_BUDGET`), so momentum ramps consistently when `TIME_BUDGET` changes.
- **`program.md`:** Agent-facing copy updated for the 30-second budget (goals, timeout guidance, autonomy section).
- **`README.md`:** User-facing descriptions and quick-start timing notes updated.

`model-training/original/program.md` is left as an upstream-style reference and still describes the 5-minute design.

## `program.md` behavioral code system design delta (vs `original/program.md`)

Relative to `model-training/original/program.md`, the active `model-training/program.md` uses a stricter behavioral-code-system framing:

- **Reaction interpreter model:** The agent is instructed to operate by firing explicit reactions from `when/where/then` conditions, instead of a free-form loop checklist.
- **Event-sourced accountability:** Every action is represented as typed events (e.g. `Requesting.requested`, `Hypothesizing.formed`, `Modifying.applied`, `Evaluating.measured`, `Logging.recorded`) with causal links.
- **Mandatory prediction calibration:** Logging now requires explicit `outcome_vs_prediction` content so the system captures mechanism learning, not only metric deltas.
- **Operational guardrails as behavior rules:** Crash handling, timeout behavior, and "same experiment id for trivial fixes" are encoded as explicit runtime rules.
- **Autonomy semantics preserved but formalized:** "Never stop" behavior from the original file is retained, but wrapped in the reaction/event protocol so autonomous execution remains auditable.
