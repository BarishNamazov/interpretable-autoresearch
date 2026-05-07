"""Integration tests for the enforcer + hooks system."""
from pathlib import Path
import textwrap

import pytest

from iar_harness.events import EventLog
from iar_harness.enforcer import Enforcer, EnforcerError
from iar_harness.hooks import HookRegistry, Reject, load_hooks
from iar_harness.program import parse_program


PROG = textwrap.dedent(
    """
    # Test
    #### `Experimenting`
    **Actions.** proposed, run, kept, discarded.

    #### `Hypothesizing`
    **Actions.** formed.

    #### `Modifying`
    **Actions.** applied, reverted.

    ```
    when:
      Experimenting.kept(?prev) OR Experimenting.discarded(?prev)
    where:
      Experimenting: no experiment is currently running
    then:
      request Hypothesizing.form(informed_by: ?prev)
    ```

    ```
    when:
      Hypothesizing.formed(?h)
    then:
      request Modifying.apply(?h)
    ```
    """
)


def _seed(log: EventLog):
    """Append the baseline experiment + a kept measurement so R1 is eligible."""
    log.append(_e(log, "Experimenting.proposed", {"experiment_id": "exp-001"}))
    log.append(_e(log, "Experimenting.run", {"experiment_id": "exp-001"}, ["evt-00001"]))
    log.append(_e(log, "Evaluating.measured", {"experiment_id": "exp-001", "status": "ok", "value": 0.5}, ["evt-00002"]))
    log.append(_e(log, "Experimenting.kept", {"experiment_id": "exp-001"}, ["evt-00003"]))


def _e(log, action, args, caused_by=None):
    from iar_harness.events import Event
    return Event(
        event_id=log.next_event_id(),
        ts="2026-01-01T00:00:00.000Z",
        by="ag",
        action=action,
        args=args,
        caused_by=caused_by or [],
    )


def test_enforcer_rejects_unauthorized_attest(tmp_path):
    program = parse_program(PROG)
    log = EventLog(tmp_path / "e.jsonl")
    enforcer = Enforcer(program, log, HookRegistry())
    # No experiment events yet → R1 not satisfied → cannot attest Hypothesizing.formed
    with pytest.raises(EnforcerError):
        enforcer.attest(
            "Hypothesizing.formed",
            args={
                "description": "x",
                "reasoning": "y",
                "prediction": {"direction": "down", "magnitude": "~", "mechanism": "z"},
            },
        )


def test_enforcer_request_then_attest(tmp_path):
    program = parse_program(PROG)
    log = EventLog(tmp_path / "e.jsonl")
    _seed(log)
    enforcer = Enforcer(program, log, HookRegistry())
    # R1 is eligible now; request Hypothesizing.form
    res, canonical = enforcer.request("Hypothesizing.form", args={})
    assert res.event.action == "Requesting.requested"
    # And attest the matching past tense
    res2 = enforcer.attest(
        "Hypothesizing.formed",
        args={
            "description": "raise lr",
            "reasoning": "exp-001 baseline; LR knob is cheap",
            "prediction": {"direction": "down", "magnitude": "~0.01", "mechanism": "less underfit"},
        },
        caused_by=[res.event.event_id],
    )
    assert res2.event.action == "Hypothesizing.formed"


def test_validator_rejects_missing_prediction(tmp_path):
    program = parse_program(PROG)
    log = EventLog(tmp_path / "e.jsonl")
    _seed(log)
    hooks = HookRegistry()
    from iar_harness.builtin_hooks.predict import assert_prediction_complete
    hooks.add_validate("Hypothesizing.formed", assert_prediction_complete)
    enforcer = Enforcer(program, log, hooks)
    enforcer.request("Hypothesizing.form")
    with pytest.raises(EnforcerError) as ei:
        enforcer.attest(
            "Hypothesizing.formed",
            args={"description": "x", "reasoning": "y", "prediction": {"direction": "", "magnitude": "", "mechanism": ""}},
        )
    assert "prediction" in str(ei.value)


def test_grounder_replaces_args(tmp_path):
    program = parse_program(PROG)
    log = EventLog(tmp_path / "e.jsonl")
    _seed(log)
    hooks = HookRegistry()
    def grd(args, log, ctx):
        return {**args, "stamped_by_hook": True}
    hooks.add_ground("Hypothesizing.form", grd)
    enforcer = Enforcer(program, log, hooks)
    res, canonical = enforcer.request("Hypothesizing.form", args={"x": 1})
    assert canonical["stamped_by_hook"] is True
    assert canonical["x"] == 1


def test_observer_warning_emits_communicating_surfaced(tmp_path):
    program = parse_program(PROG)
    log = EventLog(tmp_path / "e.jsonl")
    _seed(log)
    hooks = HookRegistry()
    hooks.add_observe("Hypothesizing.formed", lambda ev, log: ["heads up: low confidence"])
    enforcer = Enforcer(program, log, hooks)
    enforcer.request("Hypothesizing.form")
    enforcer.attest(
        "Hypothesizing.formed",
        args={
            "description": "x",
            "reasoning": "y",
            "prediction": {"direction": "down", "magnitude": "~", "mechanism": "z"},
        },
    )
    surfaced = log.by_action("Communicating.surfaced")
    assert any("low confidence" in (e.args.get("message") or "") for e in surfaced)


def test_load_hooks_real_file(tmp_path):
    hooks_file = tmp_path / "hooks.py"
    hooks_file.write_text(textwrap.dedent("""
        from iar_harness import validate, Reject
        @validate("X.y")
        def must_have_foo(event, log):
            if not event.args.get("foo"):
                raise Reject("missing foo")
    """))
    reg = load_hooks(hooks_file)
    assert "X.y" in reg.validators
