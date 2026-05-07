# `iar-harness` — interpretable autoresearch harness

A pi.dev-compatible harness that turns a `program.md` (concepts + reactions)
into a live behavioral contract enforced over the LLM's tool calls.

The agent never writes `events.jsonl` directly. Instead it sees four tools:

| Tool              | What it does                                                                 |
|-------------------|------------------------------------------------------------------------------|
| `tail_events(n)`  | The last *n* events from the log.                                            |
| `next_reactions()`| Reactions whose `when`/`where` clauses are satisfied right now.              |
| `request(action)` | Emits `Requesting.requested(...)` and runs the user's `@ground` hook for the real action. Returns canonical args. |
| `attest(action)`  | Validates an attestation event through the user's `@validate` hooks and appends it. |

`hooks.py` is a Python file the human owns. The agent has no permission to
edit it. Its decorators define the language the log is written in:

- **`@validate("X.y")`** — reject malformed claims.
- **`@ground("X.y")`** — replace the agent's claim with ground truth.
- **`@on("X.y")`** — observe and emit warnings.

## Install

```bash
cd harness
pip install -e .
```

## CLI

```bash
iar validate --program program.md --events events.jsonl --hooks hooks.py
iar replay   --program program.md --events events.jsonl --hooks hooks.py
iar next     --program program.md --events events.jsonl --hooks hooks.py
iar serve    --program program.md --events events.jsonl --hooks hooks.py
```

`iar serve` runs the JSON-RPC bridge over stdio, used by the pi extension
in `pi-extension/`.

## Use from pi.dev

```bash
# (after publishing) pi install npm:@iar/harness-pi
pi --config iar.program=program.md iar.events=events.jsonl iar.hooks=hooks.py
```

The extension exposes the four tools above. Configure the `write` and
`edit` permission deny-list in your pi settings to include `events.jsonl`
so the agent cannot bypass the harness.

## Hook example

```python
# hooks.py
from iar_harness import validate, ground, on, Reject
from iar_harness.builtin_hooks import grep_metric, shell, git

@validate("Hypothesizing.formed")
def must_predict(event, log):
    p = event.args.get("prediction") or {}
    for f in ("direction", "magnitude", "mechanism"):
        if not p.get(f):
            raise Reject(f"prediction.{f} required")

@ground("Evaluating.measure")
def measure(args, log, ctx):
    val = grep_metric.extract_val_bpb("run.log")
    if val is None:
        return {**args, "status": "crashed", "crash_excerpt": shell.tail_text("run.log", 50)}
    return {**args, "status": "ok", "metric": "val_bpb", "value": val}

@on("Modifying.applied")
def diff_must_be_real(event, log):
    sha = git.head_sha()
    if not git.diff_touches(sha, "train.py"):
        return [f"Modifying.applied claimed but git HEAD does not touch train.py"]
```

## What the harness guarantees

- **No ambient action.** Every event must be authorized by an eligible
  reaction — or explicitly tagged as `Freestyling`.
- **Predictions before outcomes.** `Hypothesizing.formed` is structurally
  required to carry `prediction.{direction,magnitude,mechanism}`.
- **Outcomes compare to predictions.** `Logging.recorded` requires a
  substantive `outcome_vs_prediction`.
- **Append-only and replayable.** `iar validate` re-runs every hook against
  an existing log to confirm it would still be accepted today.

## Tests

```bash
cd harness && pytest
```

Includes a golden-replay over the committed `model-training/events.jsonl`
and `performance-engineering/events.jsonl` plus a mocked-LLM end-to-end test.
