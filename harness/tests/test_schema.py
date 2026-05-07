from iar_harness.events import Event
from iar_harness.schema import (
    SchemaError,
    validate_envelope,
    validate_event,
    validate_payload,
)


def _ev(action, args=None, eid="evt-1", caused_by=None):
    return Event(event_id=eid, ts="2026-01-01T00:00:00Z", by="ag", action=action, args=args or {}, caused_by=caused_by or [])


def test_envelope_rejects_missing_action():
    import pytest
    with pytest.raises(SchemaError):
        validate_envelope({"event_id": "x", "ts": "t", "by": "a", "args": {}, "caused_by": []})


def test_hypothesizing_requires_prediction_fields():
    errs = validate_payload(
        "Hypothesizing.formed",
        {"description": "do thing", "reasoning": "because"},
    )
    assert any("prediction" in e for e in errs)


def test_hypothesizing_accepts_complete():
    errs = validate_payload(
        "Hypothesizing.formed",
        {
            "description": "raise lr",
            "reasoning": "exp-001 was clearly underfit",
            "prediction": {"direction": "down", "magnitude": "~0.01", "mechanism": "less underfit"},
        },
    )
    assert errs == []


def test_logging_requires_outcome_vs_prediction():
    errs = validate_payload(
        "Logging.recorded",
        {"experiment_id": "exp-002"},
    )
    assert any("outcome_vs_prediction" in e for e in errs)


def test_evaluating_ok_needs_value():
    errs = validate_payload(
        "Evaluating.measured",
        {"experiment_id": "exp-002", "status": "ok"},
    )
    assert any("value" in e or "primary" in e or "metrics" in e for e in errs)


def test_validate_event_full():
    ev = _ev("Modifying.applied", {"to": "train.py", "summary": "ok"})
    assert validate_event(ev) == []
