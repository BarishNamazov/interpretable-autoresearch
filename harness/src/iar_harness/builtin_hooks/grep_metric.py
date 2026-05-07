"""Metric extractors for `run.log` files.

Each extractor returns either a float (the measured value) or `None`
(metric absent — typically a crash). They are designed to be used inside
`@ground("Evaluating.measured")` hooks.
"""
from __future__ import annotations

import re
from pathlib import Path


_NUMERIC_LINE_RE = re.compile(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*[:=]\s*([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)")


def grep_metric(path: str | Path, key: str) -> float | None:
    """Return the *last* numeric value for `key` in a `key: value` log."""
    p = Path(path)
    if not p.exists():
        return None
    last: float | None = None
    for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
        m = _NUMERIC_LINE_RE.match(line)
        if m and m.group(1) == key:
            try:
                last = float(m.group(2))
            except ValueError:
                continue
    return last


def all_metrics(path: str | Path) -> dict[str, float]:
    """Return all `key: value` numeric pairs from the log (last value wins)."""
    out: dict[str, float] = {}
    p = Path(path)
    if not p.exists():
        return out
    for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
        m = _NUMERIC_LINE_RE.match(line)
        if m:
            try:
                out[m.group(1)] = float(m.group(2))
            except ValueError:
                continue
    return out


def extract_val_bpb(path: str | Path = "run.log") -> float | None:
    return grep_metric(path, "val_bpb")


def extract_perf_metrics(path: str | Path = "run.log") -> dict[str, float]:
    """Convenience wrapper for the performance loop.

    Pulls the standard keys the bench_e2e harness emits: primary_median_seconds,
    secondary_min_seconds, secondary_max_seconds, checksum, etc.
    """
    return all_metrics(path)


__all__ = ["grep_metric", "all_metrics", "extract_val_bpb", "extract_perf_metrics"]
