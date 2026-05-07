import textwrap
from pathlib import Path

from iar_harness.builtin_hooks.grep_metric import grep_metric, all_metrics, extract_val_bpb
from iar_harness.builtin_hooks.shell import run_with_timeout, tail_text


def test_grep_metric_extracts_last_value(tmp_path):
    p = tmp_path / "run.log"
    p.write_text("val_bpb: 0.7\nstep 1\nval_bpb: 0.65\npeak_vram_mb: 1024\n")
    assert extract_val_bpb(p) == 0.65
    assert grep_metric(p, "peak_vram_mb") == 1024.0
    assert grep_metric(p, "missing") is None
    assert all_metrics(p) == {"val_bpb": 0.65, "peak_vram_mb": 1024.0}


def test_grep_metric_missing_file(tmp_path):
    assert extract_val_bpb(tmp_path / "nope.log") is None


def test_run_with_timeout_captures_output(tmp_path):
    log = tmp_path / "out.log"
    res = run_with_timeout(["bash", "-c", "echo hello; echo val_bpb: 0.42"], log_path=log, timeout=10)
    assert res.exit_code == 0
    text = log.read_text()
    assert "hello" in text
    assert grep_metric(log, "val_bpb") == 0.42
    assert not res.timed_out


def test_run_with_timeout_kills_long_command(tmp_path):
    log = tmp_path / "out.log"
    res = run_with_timeout(["bash", "-c", "sleep 5"], log_path=log, timeout=0.5)
    assert res.timed_out


def test_tail_text(tmp_path):
    p = tmp_path / "x.log"
    p.write_text("\n".join(str(i) for i in range(100)))
    out = tail_text(p, n=3)
    assert out.splitlines() == ["97", "98", "99"]
