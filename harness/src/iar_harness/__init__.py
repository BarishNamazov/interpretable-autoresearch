"""Interpretable AutoResearch harness — public surface.

Users typically import the decorators (`validate`, `ground`, `on`) and the
`Reject` exception in their hooks files. Power users may import the
`Enforcer`, `Reactor`, `EventLog`, and `Program` to build custom drivers.
"""
from __future__ import annotations

from .events import Event, EventLog, utcnow_iso
from .program import (
    Concept,
    Program,
    Reaction,
    ThenStep,
    WhenClause,
    WhereGuard,
    load_program,
    parse_program,
)
from .schema import SchemaError, validate_event, validate_envelope, validate_payload
from .hooks import HookRegistry, Reject, validate, ground, on, load_hooks
from .reactor import Reactor, EligibleReaction
from .enforcer import Enforcer, EnforcerError, AppendResult

__version__ = "0.1.0"

__all__ = [
    "__version__",
    "Event",
    "EventLog",
    "utcnow_iso",
    "Program",
    "Concept",
    "Reaction",
    "WhenClause",
    "WhereGuard",
    "ThenStep",
    "load_program",
    "parse_program",
    "SchemaError",
    "validate_event",
    "validate_envelope",
    "validate_payload",
    "HookRegistry",
    "Reject",
    "validate",
    "ground",
    "on",
    "load_hooks",
    "Reactor",
    "EligibleReaction",
    "Enforcer",
    "EnforcerError",
    "AppendResult",
]
