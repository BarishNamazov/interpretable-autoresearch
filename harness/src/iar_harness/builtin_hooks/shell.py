"""Shell helpers for running real commands as ground truth."""
from __future__ import annotations

import shlex
import subprocess
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


@dataclass
class RunResult:
    cmd: str
    exit_code: int
    started_at: str
    finished_at: str
    duration_seconds: float
    log_path: str
    timed_out: bool


def _iso(t: float) -> str:
    return datetime.fromtimestamp(t, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + (
        f"{int((t - int(t)) * 1000):03d}Z"
    )


def run_with_timeout(
    cmd: str | list[str],
    *,
    timeout: float = 600.0,
    log_path: str | Path = "run.log",
    cwd: str | Path | None = None,
    env: dict[str, str] | None = None,
) -> RunResult:
    """Run `cmd`, capture stdout+stderr to `log_path`, return a RunResult.

    The log file is *always* written/replaced; downstream metric extractors
    point at it. We do not raise on non-zero exit; the caller (or a hook) is
    responsible for deciding what counts as a crash.
    """
    if isinstance(cmd, str):
        argv = shlex.split(cmd)
        cmd_str = cmd
    else:
        argv = list(cmd)
        cmd_str = " ".join(shlex.quote(a) for a in argv)
    log_path = Path(log_path)
    log_path.parent.mkdir(parents=True, exist_ok=True)
    started = time.time()
    timed_out = False
    with log_path.open("wb") as fh:
        try:
            proc = subprocess.Popen(
                argv,
                cwd=str(cwd) if cwd else None,
                env=env,
                stdout=fh,
                stderr=subprocess.STDOUT,
            )
            try:
                rc = proc.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
                rc = 124
                timed_out = True
        except FileNotFoundError as e:
            fh.write(f"command not found: {e}\n".encode())
            rc = 127
    finished = time.time()
    return RunResult(
        cmd=cmd_str,
        exit_code=rc,
        started_at=_iso(started),
        finished_at=_iso(finished),
        duration_seconds=finished - started,
        log_path=str(log_path),
        timed_out=timed_out,
    )


def tail_text(path: str | Path, n: int = 50) -> str:
    p = Path(path)
    if not p.exists():
        return ""
    try:
        text = p.read_text(encoding="utf-8", errors="replace")
    except Exception as e:
        return f"<could not read {p}: {e}>"
    lines = text.splitlines()
    return "\n".join(lines[-n:])


__all__ = ["RunResult", "run_with_timeout", "tail_text"]
