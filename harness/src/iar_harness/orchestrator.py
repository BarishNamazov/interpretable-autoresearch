"""Scoped session orchestrator.

The orchestrator is a *plain Python* loop with no LLM in it. It looks at
the current eligible reactions and decides which "scoped session" the LLM
should be spawned in to fulfill them. The actual spawning of pi sessions
is delegated to a `SessionDriver` interface so we can unit-test the loop
with a stub driver that emits canned tool calls.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Protocol

from .enforcer import Enforcer
from .events import Event


SCOPED_SESSION_ROUTING = {
    # action requested by the next reaction → session role that should run
    "Hypothesizing.form": "hypothesize",
    "Modifying.apply": "experiment",
    "Modifying.revert": "experiment",
    "Committing.commit": "experiment",
    "Experimenting.run": "experiment",
    "Evaluating.measure": "experiment",
    "Logging.record": "compare",
    "Discovering.discover": "discover",
    "Profiling.profile": "experiment",
    "Communicating.surface": "freestyle",
}


@dataclass
class SessionPlan:
    role: str  # "hypothesize" | "experiment" | "compare" | "discover" | "freestyle"
    reactions: list[str]  # reaction names
    hint_actions: list[str]  # the `then` actions the session should request/attest
    visible_event_ids: list[str]


class SessionDriver(Protocol):
    """Anything that can run a scoped session against an Enforcer."""

    def run_session(self, plan: SessionPlan, enforcer: Enforcer) -> None:
        ...


def plan_next(enforcer: Enforcer) -> SessionPlan | None:
    """Return the next session to run, or None if the loop has nothing to do."""
    eligible = enforcer.next_reactions()
    if not eligible:
        return None
    # Group by session role.
    grouped: dict[str, list[dict]] = {}
    for er in eligible:
        for step in er["pending_then"]:
            role = SCOPED_SESSION_ROUTING.get(step["action"], "freestyle")
            grouped.setdefault(role, []).append({"reaction": er["name"], "step": step})
    # Prefer a deterministic order so the loop is replayable.
    for role in ("discover", "hypothesize", "experiment", "compare", "freestyle"):
        if role not in grouped:
            continue
        steps = grouped[role]
        plan = SessionPlan(
            role=role,
            reactions=sorted({s["reaction"] for s in steps}),
            hint_actions=[s["step"]["action"] for s in steps],
            visible_event_ids=_visible_events_for(role, enforcer),
        )
        return plan
    return None


def _visible_events_for(role: str, enforcer: Enforcer) -> list[str]:
    events = enforcer.log.all()
    if role == "hypothesize":
        # See everything up to (and including) the latest Logging.recorded.
        last_logged_idx = -1
        for i, ev in enumerate(events):
            if ev.action == "Logging.recorded":
                last_logged_idx = i
        if last_logged_idx == -1:
            return [e.event_id for e in events]
        return [e.event_id for e in events[: last_logged_idx + 1]]
    if role == "experiment":
        # Only the latest hypothesis + everything after it (the diff window).
        last_hyp_idx = -1
        for i, ev in enumerate(events):
            if ev.action == "Hypothesizing.formed":
                last_hyp_idx = i
        if last_hyp_idx == -1:
            return [e.event_id for e in events[-5:]]
        return [e.event_id for e in events[last_hyp_idx:]]
    if role == "compare":
        # Pair the latest measurement with its motivating hypothesis.
        events_rev = list(reversed(events))
        measured = next((e for e in events_rev if e.action == "Evaluating.measured"), None)
        hyp = next((e for e in events_rev if e.action == "Hypothesizing.formed"), None)
        ids = [e.event_id for e in (hyp, measured) if e is not None]
        return ids
    if role == "discover":
        return [e.event_id for e in events[-5:]]
    return [e.event_id for e in events]  # freestyle = full visibility


def run_loop(
    enforcer: Enforcer,
    driver: SessionDriver,
    *,
    max_sessions: int = 1000,
    on_session: Callable[[SessionPlan], None] | None = None,
) -> int:
    """Drive the agent until no more reactions are eligible. Returns # sessions run."""
    n = 0
    while n < max_sessions:
        plan = plan_next(enforcer)
        if plan is None:
            return n
        if on_session:
            on_session(plan)
        driver.run_session(plan, enforcer)
        n += 1
    return n


__all__ = [
    "SessionPlan",
    "SessionDriver",
    "SCOPED_SESSION_ROUTING",
    "plan_next",
    "run_loop",
]
