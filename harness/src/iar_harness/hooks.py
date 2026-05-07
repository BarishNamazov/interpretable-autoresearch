"""Hook registry and decorators (`@validate`, `@ground`, `@on`).

Hooks are user-owned Python callables, loaded once at startup from a file
the agent has no permission to modify. They control the *language* of the
event log: validators reject malformed claims; grounders replace the
agent's claim with what's actually true; observers log/append warnings.
"""
from __future__ import annotations

import importlib.util
import sys
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from .events import Event, EventLog


class Reject(Exception):
    """Raise from a `@validate` hook to reject an event proposal."""

    def __init__(self, message: str, *, action: str | None = None):
        super().__init__(message)
        self.message = message
        self.action = action


# A validate hook receives (proposed_event, log) and may raise Reject.
ValidateHook = Callable[[Event, EventLog], None]
# A ground hook receives (proposed_args, log, context) and returns canonical args.
GroundHook = Callable[..., dict[str, Any]]
# An observer hook receives (event, log) and may emit a list of warning strings.
ObserveHook = Callable[[Event, EventLog], list[str] | None]


@dataclass
class HookRegistry:
    validators: dict[str, list[ValidateHook]] = field(default_factory=dict)
    grounders: dict[str, GroundHook] = field(default_factory=dict)
    observers: dict[str, list[ObserveHook]] = field(default_factory=dict)
    _path: Path | None = None

    def add_validate(self, action: str, fn: ValidateHook) -> None:
        self.validators.setdefault(action, []).append(fn)

    def add_ground(self, action: str, fn: GroundHook) -> None:
        if action in self.grounders:
            raise ValueError(f"duplicate @ground hook for {action}")
        self.grounders[action] = fn

    def add_observe(self, action: str, fn: ObserveHook) -> None:
        self.observers.setdefault(action, []).append(fn)

    # ---- runtime entry points ----------------------------------------
    def run_validators(self, event: Event, log: EventLog) -> None:
        for fn in self.validators.get(event.action, []):
            fn(event, log)
        # "*" wildcard hooks run for every action
        for fn in self.validators.get("*", []):
            fn(event, log)

    def run_grounder(
        self,
        action: str,
        proposed_args: dict[str, Any],
        log: EventLog,
        context: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        fn = self.grounders.get(action)
        if fn is None:
            return None
        ctx = dict(context or {})
        return fn(proposed_args, log, ctx)

    def run_observers(self, event: Event, log: EventLog) -> list[str]:
        warnings: list[str] = []
        for fn in self.observers.get(event.action, []) + self.observers.get("*", []):
            res = fn(event, log)
            if res:
                warnings.extend(res)
        return warnings


# ---- module-level "current registry" so decorators in user files work ------

_lock = threading.Lock()
_active: HookRegistry | None = None


def _ensure_active() -> HookRegistry:
    global _active
    with _lock:
        if _active is None:
            _active = HookRegistry()
        return _active


def _set_active(reg: HookRegistry | None) -> None:
    global _active
    with _lock:
        _active = reg


# ---- decorators (the user-visible surface) --------------------------------


def validate(action: str) -> Callable[[ValidateHook], ValidateHook]:
    """Register a validator for `action`. The hook may raise Reject."""

    def deco(fn: ValidateHook) -> ValidateHook:
        _ensure_active().add_validate(action, fn)
        return fn

    return deco


def ground(action: str) -> Callable[[GroundHook], GroundHook]:
    """Register a grounder for a request action.

    The hook receives (proposed_args, log, context) and MUST return the
    canonical args dict that will be stamped into the resulting attestation.
    The agent's proposal is hint-only; the grounder is the source of truth.
    """

    def deco(fn: GroundHook) -> GroundHook:
        _ensure_active().add_ground(action, fn)
        return fn

    return deco


def on(action: str) -> Callable[[ObserveHook], ObserveHook]:
    """Register a post-append observer. Observers cannot reject."""

    def deco(fn: ObserveHook) -> ObserveHook:
        _ensure_active().add_observe(action, fn)
        return fn

    return deco


# ---- loader ----------------------------------------------------------------


def load_hooks(path: str | Path) -> HookRegistry:
    """Load a hooks.py file and return its populated registry.

    Each call uses a fresh registry so multiple harness instances can coexist.
    """
    p = Path(path).resolve()
    if not p.exists():
        raise FileNotFoundError(f"hooks file not found: {p}")
    fresh = HookRegistry()
    fresh._path = p
    prev = _active
    _set_active(fresh)
    try:
        spec = importlib.util.spec_from_file_location(
            f"_iar_user_hooks_{abs(hash(str(p)))}", str(p)
        )
        if spec is None or spec.loader is None:
            raise ImportError(f"could not import hooks file {p}")
        module = importlib.util.module_from_spec(spec)
        # Make the module importable so hooks can `from x import y` from
        # files next to it.
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
    finally:
        _set_active(prev)
    return fresh


__all__ = [
    "HookRegistry",
    "Reject",
    "validate",
    "ground",
    "on",
    "load_hooks",
]
