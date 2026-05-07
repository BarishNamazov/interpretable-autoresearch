"""Enforcer: the validate-and-append engine.

The enforcer is the only path through which events reach the log. It:
  1. assigns event_id and timestamp,
  2. structurally validates the envelope and payload,
  3. checks reactor authorization (or routes to Freestyling),
  4. runs `@validate` hooks,
  5. appends to the log,
  6. runs `@on` observers and surfaces their warnings as
     `Communicating.surfaced` follow-up events.

For requests it additionally calls the matching `@ground` hook to perform
the real-world action (git, shell, file read) and returns the canonical
args that the agent should use when emitting the corresponding attestation.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .events import Event, EventLog, utcnow_iso
from .hooks import HookRegistry, Reject
from .program import Program
from .reactor import Reactor
from .schema import SchemaError, validate_event


class EnforcerError(Exception):
    """Raised when the harness refuses to append an event."""


@dataclass
class AppendResult:
    event: Event
    warnings: list[str]


class Enforcer:
    def __init__(
        self,
        program: Program,
        log: EventLog,
        hooks: HookRegistry,
        agent_id: str = "autoresearch",
        allow_freestyle: bool = True,
    ):
        self.program = program
        self.log = log
        self.hooks = hooks
        self.agent_id = agent_id
        self.allow_freestyle = allow_freestyle
        self.reactor = Reactor(program, log)

    # ---- public API -------------------------------------------------------

    def request(
        self,
        action: str,
        args: dict[str, Any] | None = None,
        caused_by: list[str] | None = None,
        by: str | None = None,
        force: bool = False,
    ) -> tuple[AppendResult, dict[str, Any]]:
        """Emit a `Requesting.requested(request=action, args=...)` event and run
        the matching `@ground` hook to perform the real action.

        Returns (the requested event, canonical args produced by the grounder).
        The caller is expected to follow up with `attest(...)` to record the
        attestation event.

        `force=True` skips reactor authorization (used by the orchestrator
        for seed events such as the baseline `Experimenting.proposed`).
        """
        args = dict(args or {})
        caused_by = list(caused_by or [])
        if not force:
            er = self.reactor.reaction_authorizing(action, kind="request")
            if er is None and not self._is_freestyle(action):
                raise EnforcerError(
                    f"no eligible reaction authorizes request {action!r}; "
                    f"either pick from next_reactions() or use Freestyling.act"
                )
            if er is not None and er.trigger_event is not None and er.trigger_event.event_id not in caused_by:
                caused_by.append(er.trigger_event.event_id)

        request_event = Event(
            event_id=self.log.next_event_id(),
            ts=utcnow_iso(),
            by=by or self.agent_id,
            action="Requesting.requested",
            args={"request": action, "args": args},
            caused_by=caused_by,
        )
        self._validate_or_raise(request_event)
        appended = self.log.append(request_event)
        warnings = self.hooks.run_observers(appended, self.log)
        result = AppendResult(event=appended, warnings=warnings)

        # Run the grounder to obtain canonical args.
        canonical = self.hooks.run_grounder(action, args, self.log, {"request_event_id": appended.event_id})
        if canonical is None:
            canonical = dict(args)
        return result, canonical

    def attest(
        self,
        action: str,
        args: dict[str, Any] | None = None,
        caused_by: list[str] | None = None,
        by: str | None = None,
        force: bool = False,
    ) -> AppendResult:
        """Validate and append an attestation event."""
        args = dict(args or {})
        caused_by = list(caused_by or [])
        if not force:
            er = self.reactor.reaction_authorizing(action, kind="attest")
            if er is None and not self._is_freestyle(action):
                # Common case: an attestation that follows a Requesting.requested
                # of the corresponding infinitive. We accept these as long as
                # such a request is the most recent same-action event group.
                if not self._has_matching_recent_request(action):
                    raise EnforcerError(
                        f"no eligible reaction authorizes attestation {action!r}; "
                        f"emit a Requesting.requested first or use Freestyling"
                    )
            if er is not None and er.trigger_event is not None and er.trigger_event.event_id not in caused_by:
                caused_by.append(er.trigger_event.event_id)

        ev = Event(
            event_id=self.log.next_event_id(),
            ts=utcnow_iso(),
            by=by or self.agent_id,
            action=action,
            args=args,
            caused_by=caused_by,
        )
        self._validate_or_raise(ev)
        appended = self.log.append(ev)
        warnings = self.hooks.run_observers(appended, self.log)
        if warnings:
            # Surface as a Communicating.surfaced follow-up so the human sees it.
            try:
                follow = Event(
                    event_id=self.log.next_event_id(),
                    ts=utcnow_iso(),
                    by="iar-harness",
                    action="Communicating.surfaced",
                    args={
                        "topic": "hook-warning",
                        "message": "; ".join(warnings),
                        "refers_to": [appended.event_id],
                    },
                    caused_by=[appended.event_id],
                )
                self.log.append(follow)
            except Exception:
                # Never let observer-warning emission itself fail the loop.
                pass
        return AppendResult(event=appended, warnings=warnings)

    # ---- introspection ----------------------------------------------------
    def next_reactions(self) -> list[dict[str, Any]]:
        """A JSON-friendly snapshot of currently eligible reactions."""
        out: list[dict[str, Any]] = []
        for er in self.reactor.eligible():
            out.append(
                {
                    "name": er.reaction.name,
                    "prose": er.reaction.prose,
                    "matched_when": er.matched_when.action,
                    "trigger_event_id": er.trigger_event.event_id if er.trigger_event else None,
                    "pending_then": [
                        {"kind": s.kind, "action": s.action, "raw": s.raw}
                        for s in er.pending_then
                    ],
                }
            )
        return out

    def tail_events(self, n: int = 20) -> list[dict[str, Any]]:
        return [e.to_dict() for e in self.log.tail(n)]

    # ---- internals --------------------------------------------------------
    def _validate_or_raise(self, ev: Event) -> None:
        # Schema validation
        errs = validate_event(ev, self.program)
        if errs:
            raise EnforcerError("; ".join(errs))
        # Validation hooks
        try:
            self.hooks.run_validators(ev, self.log)
        except Reject as e:
            raise EnforcerError(f"rejected by validator: {e.message}") from e

    def _is_freestyle(self, action: str) -> bool:
        if not self.allow_freestyle:
            return False
        return action.startswith("Freestyling.") or action == "Communicating.surfaced" or action == "Communicating.received"

    def _has_matching_recent_request(self, action: str) -> bool:
        # Look at the most recent few events for a Requesting.requested with
        # request matching the infinitive of `action`.
        from .reactor import _request_to_attest
        for ev in reversed(self.log.tail(8)):
            if ev.action == "Requesting.requested":
                requested = ev.args.get("request")
                if isinstance(requested, str) and _request_to_attest(requested) == action:
                    return True
        return False


__all__ = ["Enforcer", "EnforcerError", "AppendResult"]
