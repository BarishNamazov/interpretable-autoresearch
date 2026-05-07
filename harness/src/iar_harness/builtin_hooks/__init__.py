"""Built-in hook helpers.

These are *building blocks* for user hooks files, not auto-registered
hooks. The user's `hooks.py` imports them and decides where to apply them.
"""
from __future__ import annotations

from . import git, shell, grep_metric, predict

__all__ = ["git", "shell", "grep_metric", "predict"]
