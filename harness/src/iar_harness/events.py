"""Append-only event log and Event dataclass."""
from __future__ import annotations

import json
import threading
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Iterator


def utcnow_iso() -> str:
    """ISO-8601 UTC timestamp with millisecond precision and trailing Z."""
    now = datetime.now(timezone.utc)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"


@dataclass
class Event:
    event_id: str
    ts: str
    by: str
    action: str
    args: dict[str, Any] = field(default_factory=dict)
    caused_by: list[str] = field(default_factory=list)

    @property
    def concept(self) -> str:
        return self.action.split(".", 1)[0]

    @property
    def verb(self) -> str:
        parts = self.action.split(".", 1)
        return parts[1] if len(parts) == 2 else ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "event_id": self.event_id,
            "ts": self.ts,
            "by": self.by,
            "action": self.action,
            "args": self.args,
            "caused_by": list(self.caused_by),
        }

    def to_json_line(self) -> str:
        # No trailing newline; caller adds it.
        return json.dumps(self.to_dict(), separators=(",", ":"), sort_keys=False)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Event":
        # Tolerate missing args/caused_by from older logs.
        return cls(
            event_id=str(d["event_id"]),
            ts=str(d["ts"]),
            by=str(d.get("by", "")),
            action=str(d["action"]),
            args=dict(d.get("args") or {}),
            caused_by=list(d.get("caused_by") or []),
        )


class EventLog:
    """Append-only event log backed by a JSONL file.

    Thread-safe for the typical single-writer + readers case used by the
    harness. The file is opened lazily on the first append.
    """

    def __init__(self, path: str | Path, agent_id: str = "autoresearch"):
        self.path = Path(path)
        self.agent_id = agent_id
        self._events: list[Event] = []
        self._by_id: dict[str, Event] = {}
        self._lock = threading.RLock()
        self._next_id = 1
        if self.path.exists():
            self._load()

    # --- loading -----------------------------------------------------------
    def _load(self) -> None:
        max_id = 0
        with self.path.open("r", encoding="utf-8") as fh:
            for lineno, raw in enumerate(fh, 1):
                raw = raw.strip()
                if not raw:
                    continue
                try:
                    d = json.loads(raw)
                except json.JSONDecodeError as e:
                    raise ValueError(
                        f"events.jsonl line {lineno} is not valid JSON: {e}"
                    ) from e
                ev = Event.from_dict(d)
                self._events.append(ev)
                self._by_id[ev.event_id] = ev
                # Try to extract numeric tail of event_id like evt-00042.
                tail = ev.event_id.rsplit("-", 1)[-1]
                if tail.isdigit():
                    max_id = max(max_id, int(tail))
        self._next_id = max_id + 1

    # --- queries -----------------------------------------------------------
    def __len__(self) -> int:
        return len(self._events)

    def __iter__(self) -> Iterator[Event]:
        return iter(list(self._events))

    def all(self) -> list[Event]:
        with self._lock:
            return list(self._events)

    def tail(self, n: int) -> list[Event]:
        if n <= 0:
            return []
        with self._lock:
            return list(self._events[-n:])

    def by_id(self, event_id: str) -> Event | None:
        return self._by_id.get(event_id)

    def by_action(self, action: str) -> list[Event]:
        return [e for e in self._events if e.action == action]

    def by_concept(self, concept: str) -> list[Event]:
        return [e for e in self._events if e.concept == concept]

    def latest(self, action: str) -> Event | None:
        for ev in reversed(self._events):
            if ev.action == action:
                return ev
        return None

    # --- writes ------------------------------------------------------------
    def next_event_id(self) -> str:
        with self._lock:
            n = self._next_id
            self._next_id += 1
            return f"evt-{n:05d}"

    def append(self, event: Event) -> Event:
        with self._lock:
            if event.event_id in self._by_id:
                raise ValueError(f"duplicate event_id {event.event_id}")
            for cause in event.caused_by:
                if cause not in self._by_id:
                    raise ValueError(
                        f"event {event.event_id} references unknown caused_by={cause}"
                    )
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with self.path.open("a", encoding="utf-8") as fh:
                fh.write(event.to_json_line() + "\n")
            self._events.append(event)
            self._by_id[event.event_id] = event
            return event

    def append_many(self, events: Iterable[Event]) -> list[Event]:
        out = []
        for ev in events:
            out.append(self.append(ev))
        return out

    # --- domain projections (helpers for hooks) ---------------------------
    def experiments(self) -> list[Event]:
        return self.by_action("Experimenting.proposed")

    def hypotheses(self) -> list[Event]:
        return self.by_action("Hypothesizing.formed")

    def is_experiment_running(self) -> bool:
        """An experiment is running iff a run was started but not measured/kept/discarded."""
        runs = [e for e in self._events if e.action == "Experimenting.run"]
        if not runs:
            return False
        latest_run = runs[-1]
        exp_id = latest_run.args.get("experiment_id")
        for e in self._events:
            if e.action in ("Experimenting.kept", "Experimenting.discarded") and e.args.get("experiment_id") == exp_id:
                return False
            if e.action == "Evaluating.measured" and e.args.get("experiment_id") == exp_id:
                # Measured but not yet kept/discarded: we treat as resolved-pending.
                # The reactor will check kept/discarded explicitly.
                pass
        # If a kept/discarded for this experiment exists we returned above.
        for e in self._events:
            if e.action in ("Experimenting.kept", "Experimenting.discarded") and e.args.get("experiment_id") == exp_id:
                return False
        return True


__all__ = ["Event", "EventLog", "utcnow_iso"]
