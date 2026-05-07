"""Hypothesis discipline checks.

These implement the "load-bearing" §4 of the example program.md: every
hypothesis carries a structured prediction; every Logging.recorded carries
a substantive `outcome_vs_prediction` comparison.
"""
from __future__ import annotations

from typing import Any

from ..events import Event, EventLog
from ..hooks import Reject


_REQUIRED_PREDICTION_FIELDS = ("direction", "magnitude", "mechanism")
_MIN_OUTCOME_LEN = 12  # short heuristic so "n/a" / "ok" / "good" can't pass


def assert_prediction_complete(event: Event, log: EventLog) -> None:
    """Validator for `Hypothesizing.formed`: every prediction field is filled in."""
    p = event.args.get("prediction")
    if not isinstance(p, dict):
        raise Reject("Hypothesizing.formed.args.prediction must be an object")
    missing = [f for f in _REQUIRED_PREDICTION_FIELDS if not (isinstance(p.get(f), str) and p.get(f).strip())]
    if missing:
        raise Reject(
            f"prediction fields missing/empty: {missing} — predictions must be written before the run"
        )
    if not isinstance(event.args.get("description"), str) or not event.args["description"].strip():
        raise Reject("Hypothesizing.formed.args.description is required")
    if not isinstance(event.args.get("reasoning"), str) or not event.args["reasoning"].strip():
        raise Reject("Hypothesizing.formed.args.reasoning is required")


def assert_outcome_compares(event: Event, log: EventLog) -> None:
    """Validator for `Logging.recorded`: outcome_vs_prediction must be substantive."""
    txt = event.args.get("outcome_vs_prediction")
    if not isinstance(txt, str) or len(txt.strip()) < _MIN_OUTCOME_LEN:
        raise Reject(
            "Logging.recorded.args.outcome_vs_prediction must be a substantive comparison "
            f"(got {txt!r}); the whole point of the log is the prediction-vs-reality story"
        )


def assert_caused_by_chain(event: Event, log: EventLog) -> None:
    """Validator: every event after the first must have a non-empty caused_by."""
    if len(log) == 0:
        return  # this would be the seed event
    if not event.caused_by:
        raise Reject(
            f"event {event.action!r} has empty caused_by; only the seed event may be uncaused"
        )


def assert_baseline_or_informed(event: Event, log: EventLog) -> None:
    """Validator: a non-baseline hypothesis must cite an informing experiment."""
    informed = event.args.get("informed_by_experiment") or event.args.get("informed_by")
    has_prior_experiment = bool(log.by_action("Experimenting.proposed"))
    if has_prior_experiment and not informed:
        raise Reject(
            "non-baseline hypothesis must set informed_by_experiment to a real event_id"
        )


__all__ = [
    "assert_prediction_complete",
    "assert_outcome_compares",
    "assert_caused_by_chain",
    "assert_baseline_or_informed",
]
