"""Per-action JSON Schemas built from the program plus harness conventions.

The schemas here are a *minimum-viable* envelope: every event must have
the standard fields, and a small set of well-known action payloads are
constrained more tightly. Domain-specific validation belongs in the
user's `hooks.py`, not here — the schema layer's job is to keep the log
parseable by tools, not to enforce research discipline.
"""
from __future__ import annotations

from typing import Any

from .events import Event
from .program import Program


# ---- envelope --------------------------------------------------------------

ENVELOPE_REQUIRED = ("event_id", "ts", "by", "action", "args", "caused_by")


class SchemaError(ValueError):
    pass


def _is_str(v: Any) -> bool:
    return isinstance(v, str) and len(v) > 0


def validate_envelope(d: dict[str, Any]) -> None:
    """Validate the minimum-viable event envelope; raises SchemaError."""
    for key in ENVELOPE_REQUIRED:
        if key not in d:
            raise SchemaError(f"event missing required field: {key}")
    if not _is_str(d["event_id"]):
        raise SchemaError("event_id must be a non-empty string")
    if not _is_str(d["ts"]):
        raise SchemaError("ts must be a non-empty string")
    if not isinstance(d["by"], str):
        raise SchemaError("by must be a string")
    if not _is_str(d["action"]):
        raise SchemaError("action must be a non-empty string")
    if "." not in d["action"]:
        raise SchemaError(f"action must be Concept.verb form, got {d['action']!r}")
    if not isinstance(d["args"], dict):
        raise SchemaError("args must be an object")
    if not isinstance(d["caused_by"], list):
        raise SchemaError("caused_by must be a list")
    for cid in d["caused_by"]:
        if not _is_str(cid):
            raise SchemaError("caused_by entries must be non-empty strings")


# ---- per-action payload checks --------------------------------------------

_PREDICTION_REQUIRED_FIELDS = ("direction", "magnitude", "mechanism")


def _check_hypothesizing_formed(args: dict[str, Any]) -> list[str]:
    errs: list[str] = []
    if not _is_str(args.get("description")):
        errs.append("Hypothesizing.formed.args.description must be a non-empty string")
    if not _is_str(args.get("reasoning")):
        errs.append("Hypothesizing.formed.args.reasoning must be a non-empty string")
    p = args.get("prediction")
    if not isinstance(p, dict):
        errs.append("Hypothesizing.formed.args.prediction must be an object")
    else:
        for f in _PREDICTION_REQUIRED_FIELDS:
            if not _is_str(p.get(f)):
                errs.append(f"Hypothesizing.formed.args.prediction.{f} must be a non-empty string")
    return errs


def _check_modifying_applied(args: dict[str, Any]) -> list[str]:
    errs: list[str] = []
    # Either single `to` or a `files` list is acceptable across domains.
    if not (args.get("to") or args.get("files")):
        errs.append("Modifying.applied.args.to or .files is required")
    if not _is_str(args.get("summary", "")) and "summary" not in args and "diff_brief" not in args:
        errs.append("Modifying.applied.args.summary or .diff_brief is required")
    return errs


def _check_experimenting_run(args: dict[str, Any]) -> list[str]:
    errs: list[str] = []
    if not _is_str(args.get("experiment_id")):
        errs.append("Experimenting.run.args.experiment_id must be a non-empty string")
    return errs


def _check_evaluating_measured(args: dict[str, Any]) -> list[str]:
    errs: list[str] = []
    if not _is_str(args.get("experiment_id")):
        errs.append("Evaluating.measured.args.experiment_id must be a non-empty string")
    status = args.get("status")
    if status not in ("ok", "crashed", "tests_failed"):
        errs.append("Evaluating.measured.args.status must be one of ok|crashed|tests_failed")
    if status == "ok":
        # A primary metric value should be present in some shape.
        if "value" not in args and "metrics" not in args and "primary" not in args:
            errs.append("Evaluating.measured.args needs a value/metrics/primary when status=ok")
    return errs


def _check_logging_recorded(args: dict[str, Any]) -> list[str]:
    errs: list[str] = []
    if not _is_str(args.get("experiment_id")):
        errs.append("Logging.recorded.args.experiment_id must be a non-empty string")
    if not _is_str(args.get("outcome_vs_prediction", "")):
        errs.append("Logging.recorded.args.outcome_vs_prediction must be a non-empty string")
    return errs


_PER_ACTION = {
    "Hypothesizing.formed": _check_hypothesizing_formed,
    "Modifying.applied": _check_modifying_applied,
    "Experimenting.run": _check_experimenting_run,
    "Evaluating.measured": _check_evaluating_measured,
    "Logging.recorded": _check_logging_recorded,
}


def validate_payload(action: str, args: dict[str, Any]) -> list[str]:
    fn = _PER_ACTION.get(action)
    if fn is None:
        return []
    return fn(args)


def validate_event(event: Event, program: Program | None = None) -> list[str]:
    """Full structural validation. Returns a list of error strings (empty = ok)."""
    errs: list[str] = []
    try:
        validate_envelope(event.to_dict())
    except SchemaError as e:
        errs.append(str(e))
        return errs
    errs.extend(validate_payload(event.action, event.args))
    if program is not None:
        # Soft check: warn (via callers) if the concept isn't declared. We
        # don't hard-reject because real-world programs grow new concepts
        # over time; the user's hooks.py is the right place to make this
        # strict if they want to.
        pass
    return errs


__all__ = ["SchemaError", "validate_envelope", "validate_payload", "validate_event"]
