from pathlib import Path

import pytest

from conftest import REPO_ROOT
from iar_harness.program import parse_program, load_program


def test_parses_model_training_program():
    p = load_program(REPO_ROOT / "model-training" / "program.md")
    names = {c.name for c in p.concepts}
    # The five concepts that drive the model-training loop must be present.
    for required in ("Hypothesizing", "Modifying", "Experimenting", "Evaluating", "Logging", "Communicating"):
        assert required in names, f"missing concept {required}"
    # Reactions R1..R7 must be parsed.
    rnames = {r.name for r in p.reactions}
    for r in ("R1", "R2", "R3", "R4", "R5", "R6", "R7"):
        assert r in rnames, f"missing reaction {r}; got {rnames}"

    r1 = p.reaction("R1")
    assert r1 is not None
    # R1's `when` is two alternatives joined with OR.
    assert any(w.action == "Experimenting.kept" for w in r1.when)
    assert any(w.action == "Experimenting.discarded" for w in r1.when)
    # R1's `where` includes the no-running-experiment guard.
    assert any(g.kind == "no_running_experiment" for g in r1.where)
    # R1's `then` requests Hypothesizing.form.
    assert any(s.kind == "request" and s.action == "Hypothesizing.form" for s in r1.then)


def test_parses_performance_engineering_program():
    p = load_program(REPO_ROOT / "performance-engineering" / "program.md")
    names = {c.name for c in p.concepts}
    for required in ("Discovering", "Profiling", "Experimenting", "Hypothesizing"):
        assert required in names

    rnames = {r.name for r in p.reactions}
    # R0 — discovery is the perf-eng signature.
    assert "R0" in rnames


def test_concept_actions_extracted():
    src = """
# Demo

#### `Foo`
**Purpose.** demo.
**Actions.** `bar`, `baz`.

#### `Quux`
**Actions.** alpha, beta.

```
when:
  Foo.bar(?x)
then:
  request Quux.alpha
```
"""
    p = parse_program(src)
    foo = p.concept("Foo")
    assert foo and set(foo.actions) == {"bar", "baz"}
    quux = p.concept("Quux")
    assert quux and set(quux.actions) == {"alpha", "beta"}
    assert len(p.reactions) == 1
    r = p.reactions[0]
    assert r.when[0].action == "Foo.bar"
    assert r.then[0].kind == "request" and r.then[0].action == "Quux.alpha"


def test_freestyle_and_requesting_always_present():
    p = parse_program("# X\n")
    names = {c.name for c in p.concepts}
    assert "Requesting" in names and "Freestyling" in names
