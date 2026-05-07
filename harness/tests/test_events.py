from pathlib import Path

import pytest

from iar_harness.events import Event, EventLog


def test_append_assigns_ids_and_persists(tmp_path):
    p = tmp_path / "events.jsonl"
    log = EventLog(p, agent_id="ag-1")
    e1 = Event(event_id=log.next_event_id(), ts="2026-01-01T00:00:00.000Z", by="ag-1", action="X.y", caused_by=[])
    log.append(e1)
    assert e1.event_id == "evt-00001"
    e2 = Event(event_id=log.next_event_id(), ts="2026-01-01T00:00:01.000Z", by="ag-1", action="X.z", caused_by=[e1.event_id])
    log.append(e2)
    text = p.read_text()
    assert text.count("\n") == 2
    # Reload should preserve ids.
    log2 = EventLog(p, agent_id="ag-1")
    assert len(log2) == 2
    assert log2.next_event_id() == "evt-00003"


def test_append_rejects_duplicate_id(tmp_path):
    p = tmp_path / "events.jsonl"
    log = EventLog(p)
    e = Event(event_id="evt-00001", ts="t", by="a", action="X.y")
    log.append(e)
    with pytest.raises(ValueError):
        log.append(Event(event_id="evt-00001", ts="t2", by="a", action="X.z"))


def test_append_rejects_unknown_caused_by(tmp_path):
    p = tmp_path / "events.jsonl"
    log = EventLog(p)
    with pytest.raises(ValueError):
        log.append(Event(event_id="evt-00001", ts="t", by="a", action="X.y", caused_by=["nope"]))
