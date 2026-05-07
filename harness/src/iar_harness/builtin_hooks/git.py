"""Git ground-truth helpers."""
from __future__ import annotations

import subprocess
from pathlib import Path


class GitError(RuntimeError):
    pass


def _run(args: list[str], cwd: str | Path | None = None, check: bool = True) -> str:
    proc = subprocess.run(
        ["git", *args],
        cwd=str(cwd) if cwd else None,
        capture_output=True,
        text=True,
    )
    if check and proc.returncode != 0:
        raise GitError(
            f"git {' '.join(args)} failed (exit {proc.returncode}): {proc.stderr.strip()}"
        )
    return proc.stdout.strip()


def head_sha(cwd: str | Path | None = None) -> str:
    return _run(["rev-parse", "HEAD"], cwd=cwd)


def current_branch(cwd: str | Path | None = None) -> str:
    return _run(["rev-parse", "--abbrev-ref", "HEAD"], cwd=cwd)


def is_dirty(cwd: str | Path | None = None) -> bool:
    out = _run(["status", "--porcelain"], cwd=cwd)
    return bool(out)


def changed_files(sha: str, cwd: str | Path | None = None) -> list[str]:
    """Files changed in the given commit relative to its parent."""
    out = _run(["diff-tree", "--no-commit-id", "--name-only", "-r", sha], cwd=cwd)
    return [line for line in out.splitlines() if line]


def diff_touches(sha: str, path: str, cwd: str | Path | None = None) -> bool:
    files = changed_files(sha, cwd=cwd)
    norm = path.lstrip("./")
    return any(f == norm or f.endswith("/" + norm) or f.startswith(norm.rstrip("/") + "/") for f in files)


def commit_all(message: str, cwd: str | Path | None = None) -> str:
    """`git add -A && git commit -m <msg>`. Returns the new HEAD SHA."""
    _run(["add", "-A"], cwd=cwd)
    # If there are no staged changes the commit will fail; surface as GitError.
    _run(["commit", "-m", message], cwd=cwd)
    return head_sha(cwd=cwd)


def revert_last(cwd: str | Path | None = None) -> str:
    """Hard-reset HEAD~1. Returns the new HEAD SHA."""
    _run(["reset", "--hard", "HEAD~1"], cwd=cwd)
    return head_sha(cwd=cwd)


def assert_branch_scope(allowed: list[str], cwd: str | Path | None = None) -> None:
    """Verify that uncommitted changes touch only files within `allowed` paths."""
    out = _run(["status", "--porcelain"], cwd=cwd)
    bad: list[str] = []
    for line in out.splitlines():
        # Format is "XY path".
        if len(line) < 4:
            continue
        path = line[3:].strip().split(" -> ")[-1]
        ok = any(path == a or path.startswith(a.rstrip("/") + "/") for a in allowed)
        if not ok:
            bad.append(path)
    if bad:
        raise GitError(
            f"out-of-scope changes detected (allowed={allowed}): {bad}"
        )


__all__ = [
    "GitError",
    "head_sha",
    "current_branch",
    "is_dirty",
    "changed_files",
    "diff_touches",
    "commit_all",
    "revert_last",
    "assert_branch_scope",
]
