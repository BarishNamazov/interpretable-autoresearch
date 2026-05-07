"""Golden-replay tests against the committed events.jsonl files."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

from conftest import REPO_ROOT


def _run_validate(domain: str) -> tuple[int, str]:
    proc = subprocess.run(
        [
            sys.executable,
            "-m",
            "iar_harness.cli",
            "validate",
            "--program",
            "program.md",
            "--events",
            "events.jsonl",
            "--hooks",
            "hooks.py",
        ],
        cwd=str(REPO_ROOT / domain),
        capture_output=True,
        text=True,
    )
    return proc.returncode, proc.stdout + proc.stderr


def test_model_training_log_validates():
    rc, out = _run_validate("model-training")
    assert rc == 0, f"model-training validation failed:\n{out}"
    assert "0 errors" in out


def test_performance_engineering_log_validates():
    rc, out = _run_validate("performance-engineering")
    assert rc == 0, f"performance-engineering validation failed:\n{out}"
    assert "0 errors" in out


def test_negative_missing_prediction_is_rejected(tmp_path):
    """Mutate a hypothesis to drop prediction.mechanism and assert it's rejected."""
    src = (REPO_ROOT / "model-training" / "events.jsonl").read_text().splitlines()
    # Find the first Hypothesizing.formed and break its prediction.
    import json
    mutated_lines = []
    found = False
    for raw in src:
        d = json.loads(raw)
        if not found and d["action"] == "Hypothesizing.formed":
            d["args"]["prediction"]["mechanism"] = ""
            found = True
        mutated_lines.append(json.dumps(d))
    assert found, "fixture must contain a Hypothesizing.formed"
    bad = tmp_path / "events.jsonl"
    bad.write_text("\n".join(mutated_lines) + "\n")
    proc = subprocess.run(
        [
            sys.executable,
            "-m",
            "iar_harness.cli",
            "validate",
            "--program",
            str(REPO_ROOT / "model-training" / "program.md"),
            "--events",
            str(bad),
            "--hooks",
            str(REPO_ROOT / "model-training" / "hooks.py"),
        ],
        capture_output=True,
        text=True,
        cwd=str(REPO_ROOT / "model-training"),
    )
    assert proc.returncode == 1
    assert "prediction" in (proc.stdout + proc.stderr)
