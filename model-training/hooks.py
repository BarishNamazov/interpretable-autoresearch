# hooks.py — model-training behavioral enforcement
#
# This file is owned by the human researcher. The agent is forbidden from
# editing it; it defines what counts as a well-formed event in the
# model-training autoresearch loop.
#
# Three kinds of hook:
#   @validate("X.y") — reject malformed claims before they enter the log.
#   @ground("X.y")   — replace the agent's claim with ground truth (read
#                      from disk / git / shell). Used for measurements and
#                      modifications that must reflect reality.
#   @on("X.y")       — observe events after they're appended; can append
#                      `Communicating.surfaced` warnings.
from __future__ import annotations

from pathlib import Path

from iar_harness import Reject, ground, on, validate
from iar_harness.builtin_hooks import git, grep_metric, predict, shell


# Run-log relative to the model-training/ directory. The harness is invoked
# with `--events events.jsonl --hooks hooks.py` from inside model-training/.
RUN_LOG = "run.log"
TRAIN_FILE = "train.py"


# ---- Hypothesis discipline (interpretability load-bearing) ----------------


@validate("Hypothesizing.formed")
def hypothesis_is_complete(event, log):
    """Every hypothesis must carry a complete prediction (§4 of program.md)."""
    predict.assert_prediction_complete(event, log)


@validate("Hypothesizing.formed")
def non_baseline_must_cite_prior(event, log):
    """A non-baseline hypothesis must cite an experiment it was informed by."""
    predict.assert_baseline_or_informed(event, log)


@validate("Logging.recorded")
def outcome_compares_to_prediction(event, log):
    """Logging.recorded must include a substantive outcome_vs_prediction."""
    predict.assert_outcome_compares(event, log)


# ---- Modifying.applied: the file actually changed -------------------------


@on("Modifying.applied")
def modifying_must_touch_train_py(event, log):
    """If we say we modified train.py, the working tree (or last commit) should agree."""
    target = event.args.get("to") or (event.args.get("files") or [None])[0]
    if target != TRAIN_FILE:
        return [f"Modifying.applied target {target!r} is outside the allowed scope (train.py)"]
    try:
        if git.is_dirty():
            # Working tree changes haven't been committed yet — that's fine
            # at this point; R3 will commit them next.
            return None
        sha = git.head_sha()
        if not git.diff_touches(sha, TRAIN_FILE):
            return [f"Modifying.applied claimed but git HEAD ({sha[:8]}) does not touch {TRAIN_FILE}"]
    except git.GitError:
        # Not in a git repo (e.g. tests/CI without one); silently skip.
        return None
    return None


# ---- Evaluating.measured: the metric is what's in run.log -----------------


@ground("Evaluating.measure")
def measure_val_bpb(args, log, ctx):
    """Replace the agent's claim with the actual val_bpb in run.log."""
    val = grep_metric.extract_val_bpb(RUN_LOG)
    peak = grep_metric.grep_metric(RUN_LOG, "peak_vram_mb")
    if val is None:
        # No metric → treat as crashed.
        return {
            **args,
            "metric": "val_bpb",
            "status": "crashed",
            "crash_excerpt": shell.tail_text(RUN_LOG, 50),
            "peak_vram_mb": peak,
        }
    return {
        **args,
        "metric": "val_bpb",
        "value": val,
        "status": "ok",
        "peak_vram_mb": peak,
    }


@validate("Evaluating.measured")
def measured_status_consistency(event, log):
    """status=ok requires a numeric value; status=crashed requires a crash excerpt."""
    a = event.args
    if a.get("status") == "ok" and not isinstance(a.get("value"), (int, float)):
        raise Reject("Evaluating.measured.status=ok requires args.value to be a number")
    if a.get("status") == "crashed" and not isinstance(a.get("crash_excerpt"), str):
        raise Reject("Evaluating.measured.status=crashed requires args.crash_excerpt")


# ---- Experimenting.run: actually invoke training --------------------------


@ground("Experimenting.run")
def run_training(args, log, ctx):
    """Invoke `uv run train.py`, capture to run.log, return canonical args.

    The agent's claim about start/finish times is replaced by what actually
    happened in the subprocess.
    """
    res = shell.run_with_timeout(
        ["uv", "run", "train.py"],
        timeout=300.0,
        log_path=RUN_LOG,
    )
    sha = None
    try:
        sha = git.head_sha()
    except git.GitError:
        pass
    return {
        **args,
        "started_at": res.started_at,
        "finished_at": res.finished_at,
        "duration_seconds": res.duration_seconds,
        "exit_code": res.exit_code,
        "commit_sha": sha,
        "log_path": str(res.log_path),
        "timed_out": res.timed_out,
    }


# ---- Modifying.revert: real `git reset --hard HEAD~1` --------------------


@ground("Modifying.revert")
def revert_change(args, log, ctx):
    try:
        new_sha = git.revert_last()
        return {**args, "restoring": TRAIN_FILE, "new_head_sha": new_sha}
    except git.GitError as e:
        # Surface but do not crash the loop; the attestation will be allowed
        # so the human can see the failure.
        return {**args, "restoring": TRAIN_FILE, "error": str(e)}
