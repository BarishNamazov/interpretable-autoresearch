from pathlib import Path

import pytest

from iar_harness.events import Event, EventLog
from iar_harness.program import parse_program
from iar_harness.reactor import Reactor


PROGRAM = """
# Test

#### `Experimenting`
**Actions.** proposed, run, kept, discarded.

#### `Hypothesizing`
**Actions.** formed.

```
when:
  Experimenting.kept(?prev) OR Experimenting.discarded(?prev)
where:
  Experimenting: no experiment is currently running
then:
  request Hypothesizing.form(informed_by: ?prev)
```
"""


def _ev(eid, action, args=None, caused_by=None):
    return Event(event_id=eid, ts="2026-01-01T00:00:00.000Z", by="ag", action=action, args=args or {}, caused_by=caused_by or [])


def test_eligible_after_keep(tmp_path):
    p = parse_program(PROGRAM)
    log = EventLog(tmp_path / "e.jsonl")
    log.append(_ev("evt-00001", "Experimenting.proposed", {"experiment_id": "exp-001"}))
    log.append(_ev("evt-00002", "Experimenting.run", {"experiment_id": "exp-001"}, caused_by=["evt-00001"]))
    log.append(_ev("evt-00003", "Evaluating.measured", {"experiment_id": "exp-001", "status": "ok", "value": 0.7}, caused_by=["evt-00002"]))
    log.append(_ev("evt-00004", "Experimenting.kept", {"experiment_id": "exp-001"}, caused_by=["evt-00003"]))

    r = Reactor(p, log)
    eligible = r.eligible()
    assert any(er.reaction.name.startswith("R") and any(s.action == "Hypothesizing.form" for s in er.pending_then) for er in eligible)


def test_then_marked_completed(tmp_path):
    p = parse_program(PROGRAM)
    log = EventLog(tmp_path / "e.jsonl")
    log.append(_ev("evt-00001", "Experimenting.proposed", {"experiment_id": "exp-001"}))
    log.append(_ev("evt-00002", "Experimenting.run", {"experiment_id": "exp-001"}, caused_by=["evt-00001"]))
    log.append(_ev("evt-00003", "Evaluating.measured", {"experiment_id": "exp-001", "status": "ok", "value": 0.7}, caused_by=["evt-00002"]))
    log.append(_ev("evt-00004", "Experimenting.kept", {"experiment_id": "exp-001"}, caused_by=["evt-00003"]))
    # Now fulfill the request: emit the request event AND the attestation.
    log.append(_ev("evt-00005", "Requesting.requested", {"request": "Hypothesizing.form"}, caused_by=["evt-00004"]))
    log.append(_ev("evt-00006", "Hypothesizing.formed", {
        "description": "x", "reasoning": "y",
        "prediction": {"direction": "down", "magnitude": "~0.01", "mechanism": "z"},
    }, caused_by=["evt-00005"]))

    r = Reactor(p, log)
    eligible = r.eligible()
    # That reaction is now satisfied; nothing left to do.
    assert not any(any(s.action == "Hypothesizing.form" for s in er.pending_then) for er in eligible)


def test_no_eligible_while_running(tmp_path):
    p = parse_program(PROGRAM)
    log = EventLog(tmp_path / "e.jsonl")
    # Start a run that hasn't been kept/discarded.
    log.append(_ev("evt-00001", "Experimenting.proposed", {"experiment_id": "exp-001"}))
    log.append(_ev("evt-00002", "Experimenting.run", {"experiment_id": "exp-001"}, caused_by=["evt-00001"]))
    # No keep/discard yet → reaction R1 should not fire even if a stale keep lives in the log.
    r = Reactor(p, log)
    elig = r.eligible()
    # No Experimenting.kept event, so R1 won't match `when` either.
    assert not any(s.action == "Hypothesizing.form" for er in elig for s in er.pending_then)
