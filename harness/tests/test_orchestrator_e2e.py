"""Mocked-LLM end-to-end: a stub session driver that emits canned tool calls."""
from __future__ import annotations

import textwrap
from pathlib import Path

from iar_harness.events import Event, EventLog
from iar_harness.enforcer import Enforcer
from iar_harness.hooks import HookRegistry
from iar_harness.orchestrator import SessionPlan, plan_next, run_loop
from iar_harness.program import parse_program


PROG = textwrap.dedent("""
# T
#### `Experimenting`
**Actions.** proposed, run, kept, discarded.
#### `Hypothesizing`
**Actions.** formed.
#### `Modifying`
**Actions.** applied, reverted.
#### `Evaluating`
**Actions.** measured.
#### `Logging`
**Actions.** recorded.

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

```
when:
  Modifying.applied(?c)
then:
  request Experimenting.run(?e)
```

```
when:
  Experimenting.run(?e)
then:
  request Evaluating.measure(?e)
```

```
when:
  Evaluating.measured(?v)
where:
  Evaluating: ?value < ?best
then:
  Experimenting.kept(?e)
  request Logging.record(?e)
```
""")


class CannedDriver:
    """A driver that, for each plan, emits the next reaction's then-step.

    For requests, it proposes a plausible payload; for attests it follows
    immediately with the past-tense event.
    """

    def __init__(self):
        self.sessions = []

    def run_session(self, plan: SessionPlan, enf: Enforcer) -> None:
        self.sessions.append(plan)
        # For each pending action listed in the plan, run it once.
        for action in plan.hint_actions:
            if action == "Hypothesizing.form":
                req, _ = enf.request("Hypothesizing.form", args={})
                enf.attest(
                    "Hypothesizing.formed",
                    args={
                        "description": "raise lr by 1.5x",
                        "reasoning": "previous baseline shows underfit on val_bpb",
                        "prediction": {"direction": "down", "magnitude": "~0.01", "mechanism": "less underfit"},
                        "informed_by_experiment": "exp-001",
                    },
                    caused_by=[req.event.event_id],
                )
            elif action == "Modifying.apply":
                req, _ = enf.request("Modifying.apply", args={"to": "train.py"})
                enf.attest(
                    "Modifying.applied",
                    args={"to": "train.py", "summary": "raise lr"},
                    caused_by=[req.event.event_id],
                )
            elif action == "Experimenting.run":
                req, _ = enf.request("Experimenting.run", args={"experiment_id": "exp-002"})
                enf.attest(
                    "Experimenting.run",
                    args={"experiment_id": "exp-002", "started_at": "t0", "finished_at": "t1"},
                    caused_by=[req.event.event_id],
                )
            elif action == "Evaluating.measure":
                req, _ = enf.request("Evaluating.measure", args={"experiment_id": "exp-002"})
                enf.attest(
                    "Evaluating.measured",
                    args={"experiment_id": "exp-002", "status": "ok", "value": 0.4, "metric": "val_bpb"},
                    caused_by=[req.event.event_id],
                )
            elif action == "Logging.record":
                req, _ = enf.request("Logging.record", args={"experiment_id": "exp-002"})
                enf.attest(
                    "Logging.recorded",
                    args={
                        "experiment_id": "exp-002",
                        "outcome_vs_prediction": "matched: dropped to 0.4 (predicted ~0.01 drop)",
                    },
                    caused_by=[req.event.event_id],
                )


def _seed(log: EventLog):
    def e(action, args, caused_by=None):
        return Event(
            event_id=log.next_event_id(),
            ts="2026-01-01T00:00:00.000Z",
            by="ag",
            action=action,
            args=args,
            caused_by=caused_by or [],
        )

    log.append(e("Experimenting.proposed", {"experiment_id": "exp-001"}))
    log.append(e("Experimenting.run", {"experiment_id": "exp-001"}, ["evt-00001"]))
    log.append(e("Evaluating.measured", {"experiment_id": "exp-001", "status": "ok", "value": 0.5}, ["evt-00002"]))
    log.append(e("Experimenting.kept", {"experiment_id": "exp-001"}, ["evt-00003"]))


def test_end_to_end_runs_one_full_cycle(tmp_path):
    program = parse_program(PROG)
    log = EventLog(tmp_path / "events.jsonl")
    _seed(log)
    enforcer = Enforcer(program, log, HookRegistry())
    driver = CannedDriver()
    n = run_loop(enforcer, driver, max_sessions=20)
    assert n >= 1
    # Result should include a Logging.recorded for the second experiment.
    actions = [e.action for e in log.all()]
    assert "Hypothesizing.formed" in actions
    assert "Modifying.applied" in actions
    assert "Experimenting.run" in actions
    # Two Experimenting.run events: the seed and the new one.
    assert sum(1 for a in actions if a == "Experimenting.run") >= 2
    assert "Evaluating.measured" in actions
    assert "Logging.recorded" in actions
