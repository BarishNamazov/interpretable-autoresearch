# hooks.py — performance-engineering behavioral enforcement
#
# Adds, on top of the basic hypothesis discipline:
#   - Profiling.profiled must reference a real perf file.
#   - Discovering.completed must record a noise floor and codebase map.
#   - Evaluating.measured carries a `significance` flag that's
#     cross-checked against the discovery noise floor.
from __future__ import annotations

from pathlib import Path

from iar_harness import Reject, ground, on, validate
from iar_harness.builtin_hooks import git, grep_metric, predict, shell


RUN_LOG = "run.log"
ALLOWED_PATHS = ["src/", "bench_e2e.py"]


# ---- Hypothesis discipline ------------------------------------------------


@validate("Hypothesizing.formed")
def hypothesis_is_complete(event, log):
    predict.assert_prediction_complete(event, log)


@validate("Hypothesizing.formed")
def hypothesis_must_cite_profile(event, log):
    """Performance hypotheses must trace back to a recent Profiling.profiled."""
    informed = event.args.get("informed_by_profile") or event.args.get("informed_by")
    profiles = log.by_action("Profiling.profiled")
    if profiles and not informed:
        raise Reject(
            "performance hypotheses must cite informed_by_profile (a recent Profiling.profiled event_id)"
        )


@validate("Logging.recorded")
def outcome_compares_to_prediction(event, log):
    predict.assert_outcome_compares(event, log)


# ---- Discovery: must record real noise floor ------------------------------


@validate("Discovering.completed")
def discovery_records_noise_floor(event, log):
    bench = event.args.get("benchmark")
    if not isinstance(bench, dict):
        raise Reject("Discovering.completed.args.benchmark must be an object")
    nf = bench.get("noise_floor")
    if not isinstance(nf, dict):
        raise Reject("Discovering.completed.args.benchmark.noise_floor must be an object")
    runs = nf.get("primary_metric_value_runs")
    if not isinstance(runs, list) or len(runs) < 3:
        raise Reject(
            "noise_floor.primary_metric_value_runs must be a list of >=3 measured runs"
        )
    if not isinstance(nf.get("spread_pct"), (int, float)):
        raise Reject("noise_floor.spread_pct must be a number")


@validate("Discovering.completed")
def discovery_records_codebase_map(event, log):
    cm = event.args.get("codebase_map")
    if not isinstance(cm, dict) or not isinstance(cm.get("module_summaries"), list) or not cm["module_summaries"]:
        raise Reject("Discovering.completed.args.codebase_map.module_summaries must be a non-empty list")


# ---- Profiling.profiled: must reference a real perf file -----------------


@validate("Profiling.profiled")
def profile_references_real_file(event, log):
    path = event.args.get("perf_file") or event.args.get("path")
    if path:
        if not Path(path).exists():
            raise Reject(f"Profiling.profiled references missing perf file {path!r}")
    # Even without a file, a hot_attribution map is required.
    ha = event.args.get("hot_attribution") or event.args.get("attribution")
    if not isinstance(ha, list) or not ha:
        raise Reject(
            "Profiling.profiled.args.hot_attribution must be a non-empty list of {function, percent_of_total}"
        )


# ---- Evaluating: ground primary metric from bench output ------------------


@ground("Evaluating.measure")
def measure_perf(args, log, ctx):
    metrics = grep_metric.extract_perf_metrics(RUN_LOG)
    primary = metrics.get("primary_median_seconds")
    if primary is None:
        return {
            **args,
            "primary": None,
            "metrics": metrics,
            "status": "crashed",
            "crash_excerpt": shell.tail_text(RUN_LOG, 50),
        }
    # Cross-check checksum.
    checksum_ok = metrics.get("checksum_ok", 1.0) >= 0.5
    return {
        **args,
        "primary": {"key": "primary_median_seconds", "value": primary},
        "metrics": metrics,
        "status": "ok" if checksum_ok else "tests_failed",
    }


@on("Evaluating.measured")
def measured_significance_cross_check(event, log):
    """Compare against the *current best* using noise spread.

    This is an observer (not a validator) because significance is a judgment
    call: the agent may legitimately claim 'above_noise' against the previous
    experiment rather than the all-time best, or vice versa. We surface the
    discrepancy to the human via Communicating.surfaced rather than
    rejecting the event.
    """
    a = event.args
    if a.get("status") != "ok":
        return None
    primary = a.get("primary")
    val = None
    if isinstance(primary, dict):
        val = primary.get("value")
    elif "value" in a:
        val = a["value"]
    if not isinstance(val, (int, float)):
        return None
    discoveries = log.by_action("Discovering.completed")
    if not discoveries:
        return None
    nf = (discoveries[-1].args.get("benchmark") or {}).get("noise_floor") or {}
    runs = nf.get("primary_metric_value_runs") or []
    spread_pct = nf.get("spread_pct")
    if not runs or not isinstance(spread_pct, (int, float)):
        return None
    baseline = sum(runs) / len(runs)
    kept_ids = {e.args.get("experiment_id") for e in log.by_action("Experimenting.kept")}
    best = baseline
    for ev in log.by_action("Evaluating.measured"):
        if ev.args.get("experiment_id") not in kept_ids:
            continue
        p = ev.args.get("primary")
        v = p.get("value") if isinstance(p, dict) else ev.args.get("value")
        if isinstance(v, (int, float)) and v < best:
            best = v
    rel_improvement = (best - val) / best * 100.0 if best else 0.0
    declared = a.get("significance")
    inferred = "above_noise" if rel_improvement > spread_pct else "below_noise"
    if declared and declared != inferred:
        return [
            f"significance={declared!r} disagrees with inferred={inferred!r} "
            f"(best={best:.4f}, val={val:.4f}, improvement={rel_improvement:.2f}%, "
            f"spread_pct={spread_pct})"
        ]
    return None


# ---- Modifying.applied: real diff confined to allowed paths --------------


@on("Modifying.applied")
def modifying_within_scope(event, log):
    files = event.args.get("files") or ([event.args["to"]] if event.args.get("to") else [])
    bad = [f for f in files if not any(f == p or f.startswith(p) for p in ALLOWED_PATHS)]
    if bad:
        return [f"Modifying.applied lists out-of-scope files: {bad}"]
    try:
        if not git.is_dirty():
            sha = git.head_sha()
            actual = git.changed_files(sha)
            for f in files:
                if f not in actual:
                    return [f"Modifying.applied claims {f!r} but git HEAD does not include it"]
    except git.GitError:
        return None
    return None


# ---- Experimenting.run: invoke the bench --------------------------------


@ground("Experimenting.run")
def run_bench(args, log, ctx):
    res = shell.run_with_timeout(
        ["python3", "bench_e2e.py", "--runs", "5"],
        timeout=600.0,
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
