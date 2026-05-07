"""Reactor: given the current event log, decide which reactions are eligible.

The reactor is the structural arm of "the agent has no ambient action". Any
attestation/request the agent attempts must fall under at least one
eligible reaction (or be explicitly tagged as `Freestyling`).
"""
from __future__ import annotations

from dataclasses import dataclass

from .events import Event, EventLog
from .program import Program, Reaction, ThenStep, WhenClause, WhereGuard


@dataclass
class EligibleReaction:
    reaction: Reaction
    matched_when: WhenClause
    trigger_event: Event | None  # None for "seed" reactions; otherwise the event that satisfied `when`
    pending_then: list[ThenStep]


# ---- guard evaluation ------------------------------------------------------


def _no_running_experiment(log: EventLog) -> bool:
    # An "experiment is running" iff the latest Experimenting.run for the
    # latest experiment has not been resolved by Experimenting.kept/discarded.
    runs = log.by_action("Experimenting.run")
    if not runs:
        return True
    latest_run = runs[-1]
    exp = latest_run.args.get("experiment_id")
    for ev in log.all():
        if ev.action in ("Experimenting.kept", "Experimenting.discarded") and ev.args.get("experiment_id") == exp:
            return True
    return False


def _best_value(log: EventLog) -> float | None:
    """Return the current best (lowest) primary value across kept measurements."""
    kept_ids = {e.args.get("experiment_id") for e in log.by_action("Experimenting.kept")}
    best: float | None = None
    for ev in log.by_action("Evaluating.measured"):
        if ev.args.get("experiment_id") not in kept_ids:
            continue
        v = _primary_value(ev.args)
        if v is None:
            continue
        if best is None or v < best:
            best = v
    return best


def _primary_value(args: dict) -> float | None:
    if "value" in args and isinstance(args["value"], (int, float)):
        return float(args["value"])
    p = args.get("primary")
    if isinstance(p, dict) and isinstance(p.get("value"), (int, float)):
        return float(p["value"])
    return None


def _experiment_value(log: EventLog, experiment_id: str) -> float | None:
    for ev in log.by_action("Evaluating.measured"):
        if ev.args.get("experiment_id") == experiment_id:
            return _primary_value(ev.args)
    return None


def _experiment_crashed(log: EventLog, experiment_id: str) -> bool:
    for ev in log.by_action("Evaluating.measured"):
        if ev.args.get("experiment_id") == experiment_id:
            return ev.args.get("status") == "crashed"
    return False


def _experiment_has_metric(log: EventLog, experiment_id: str) -> bool:
    for ev in log.by_action("Evaluating.measured"):
        if ev.args.get("experiment_id") == experiment_id:
            return _primary_value(ev.args) is not None
    return False


def _eval_guard(guard: WhereGuard, log: EventLog, trigger: Event | None) -> bool:
    """Evaluate one classified guard. Free-form guards default to True."""
    if guard.kind == "no_running_experiment":
        return _no_running_experiment(log)
    exp_id = trigger.args.get("experiment_id") if trigger else None
    if guard.kind == "value_lt_best":
        v = _primary_value(trigger.args) if trigger else None
        best = _best_value(log)
        if v is None:
            return False
        return best is None or v < best
    if guard.kind == "value_gte_best":
        v = _primary_value(trigger.args) if trigger else None
        best = _best_value(log)
        if v is None:
            return False
        return best is not None and v >= best
    if guard.kind == "no_recorded_metric":
        if not exp_id:
            return False
        return not _experiment_has_metric(log, str(exp_id))
    if guard.kind == "is_crashed":
        if not exp_id:
            return False
        return _experiment_crashed(log, str(exp_id))
    return True  # free-form / unknown → permissive (matches today's loose semantics)


# ---- pending-then projection ----------------------------------------------


def _completed_then_step(step: ThenStep, trigger: Event | None, log: EventLog) -> bool:
    """Has this `then:` step already been fulfilled in the log following the trigger?

    We consider a step completed if there exists, after the trigger, a matching
    event:
      - request → a Requesting.requested whose args.request == step.action
      - attest  → an event with action == step.action
    """
    after_idx = 0
    if trigger is not None:
        all_events = log.all()
        for i, ev in enumerate(all_events):
            if ev.event_id == trigger.event_id:
                after_idx = i + 1
                break
        scope = all_events[after_idx:]
    else:
        scope = log.all()

    if step.kind == "request":
        target = step.action
        for ev in scope:
            if ev.action == "Requesting.requested" and ev.args.get("request") == target:
                return True
            # Some implementations skip the explicit Requesting.requested
            # and emit the past-tense attestation directly.
            if ev.action == _request_to_attest(target):
                return True
        return False
    # attest
    for ev in scope:
        if ev.action == step.action:
            return True
    return False


def _request_to_attest(action: str) -> str:
    """Best-effort mapping from request infinitive → attestation past tense."""
    concept, verb = action.split(".", 1) if "." in action else (action, "")
    mapping = {
        "form": "formed",
        "apply": "applied",
        "revert": "reverted",
        "commit": "committed",
        "run": "run",
        "measure": "measured",
        "record": "recorded",
        "discover": "completed",
        "profile": "profiled",
        "surface": "surfaced",
    }
    past = mapping.get(verb, verb + "d" if verb and not verb.endswith("d") else verb)
    return f"{concept}.{past}"


# ---- main API --------------------------------------------------------------


class Reactor:
    def __init__(self, program: Program, log: EventLog):
        self.program = program
        self.log = log

    # All reactions whose `when` would match the *latest* event(s) in the log
    # AND whose `where` guards hold AND whose `then` is not already completed.
    def eligible(self) -> list[EligibleReaction]:
        out: list[EligibleReaction] = []
        events = self.log.all()
        if not events:
            # Seed mode: only reactions whose `when` is empty/seed-like fire.
            return out

        # Walk the reactions in declaration order. For each reaction, find the
        # most recent event that matches one of its `when` alternatives; check
        # `where` guards relative to that trigger; if `then` has unfinished
        # steps, the reaction is eligible.
        for r in self.program.reactions:
            best_match: tuple[WhenClause, Event] | None = None
            for w in r.when:
                if not w.action:
                    continue
                for ev in reversed(events):
                    if ev.action == w.action:
                        best_match = (w, ev)
                        break
                if best_match is not None:
                    break
            if best_match is None:
                continue
            matched_when, trigger = best_match

            if not all(_eval_guard(g, self.log, trigger) for g in r.where):
                continue

            pending = [s for s in r.then if not _completed_then_step(s, trigger, self.log)]
            if not pending:
                continue
            out.append(EligibleReaction(reaction=r, matched_when=matched_when, trigger_event=trigger, pending_then=pending))
        return out

    def reaction_authorizing(self, action: str, kind: str) -> EligibleReaction | None:
        """Find an eligible reaction whose pending `then` contains the given step.

        `kind` is "request" or "attest".
        """
        for er in self.eligible():
            for step in er.pending_then:
                if step.kind == kind and step.action == action:
                    return er
        return None


__all__ = ["Reactor", "EligibleReaction"]
