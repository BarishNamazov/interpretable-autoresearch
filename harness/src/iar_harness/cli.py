"""`iar` command-line interface."""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from .enforcer import Enforcer, EnforcerError
from .events import Event, EventLog
from .hooks import HookRegistry, Reject, load_hooks
from .pi_bridge import PiBridge
from .program import load_program
from .schema import validate_event


def _load(args) -> tuple:
    program = load_program(args.program)
    log = EventLog(args.events, agent_id=args.agent_id)
    hooks = load_hooks(args.hooks) if args.hooks else HookRegistry()
    enforcer = Enforcer(program, log, hooks, agent_id=args.agent_id)
    return program, log, hooks, enforcer


# --- subcommands ------------------------------------------------------------


def cmd_validate(args) -> int:
    """Replay-validate an existing events.jsonl against program.md and hooks.py.

    Walks the log start-to-finish. For each event:
      1. Schema-validate the envelope and payload.
      2. Re-run any matching `@validate` hook against the event (with a
         `partial_log` that contains everything up to but NOT including it).
      3. Re-run `@on` observers for warnings.
    Reports a count of errors and warnings; exits 0 iff zero errors.
    """
    program = load_program(args.program)
    hooks = load_hooks(args.hooks) if args.hooks else HookRegistry()

    src = Path(args.events)
    if not src.exists():
        print(f"events file not found: {src}", file=sys.stderr)
        return 2

    # Build a *replay* log incrementally.
    replay_path = Path(args.scratch) if args.scratch else None
    if replay_path is None:
        # In-memory only: pass an EventLog backed by a tmp file we delete.
        import tempfile
        tmp = tempfile.NamedTemporaryFile(prefix="iar-validate-", suffix=".jsonl", delete=False)
        tmp.close()
        replay_path = Path(tmp.name)
    if replay_path.exists():
        replay_path.unlink()
    log = EventLog(replay_path, agent_id=args.agent_id)

    errors: list[str] = []
    warnings: list[str] = []
    n = 0
    with src.open("r", encoding="utf-8") as fh:
        for lineno, raw in enumerate(fh, 1):
            raw = raw.strip()
            if not raw:
                continue
            try:
                d = json.loads(raw)
            except json.JSONDecodeError as e:
                errors.append(f"line {lineno}: invalid json: {e}")
                continue
            try:
                ev = Event.from_dict(d)
            except Exception as e:
                errors.append(f"line {lineno}: bad envelope: {e}")
                continue
            envelope_errs = validate_event(ev, program)
            for err in envelope_errs:
                errors.append(f"line {lineno} ({ev.event_id}): {err}")
            try:
                hooks.run_validators(ev, log)
            except Reject as e:
                errors.append(f"line {lineno} ({ev.event_id}): rejected by validator: {e.message}")
            # Append regardless so subsequent guards see it.
            try:
                log.append(ev)
            except ValueError as e:
                errors.append(f"line {lineno} ({ev.event_id}): append failed: {e}")
                continue
            ws = hooks.run_observers(ev, log)
            for w in ws:
                warnings.append(f"line {lineno} ({ev.event_id}): {w}")
            n += 1

    print(f"validated {n} events: {len(errors)} errors, {len(warnings)} warnings")
    for e in errors:
        print(f"  ERROR  {e}")
    for w in warnings:
        print(f"  warn   {w}")
    if not args.scratch:
        try:
            replay_path.unlink()
        except OSError:
            pass
    return 0 if not errors else 1


def cmd_replay(args) -> int:
    """Alias for `validate` that always shows warnings, never errors-out."""
    args.scratch = None
    rc = cmd_validate(args)
    return 0 if rc <= 1 else rc


def cmd_serve(args) -> int:
    """Run the JSON-RPC bridge over stdio (used by the pi extension)."""
    program, log, hooks, enforcer = _load(args)
    bridge = PiBridge(enforcer)
    bridge.serve()
    return 0


def cmd_run(args) -> int:
    """Drive the loop locally (currently expects a Python session driver)."""
    print(
        "iar run: native pi integration is provided via the `iar serve` JSON-RPC "
        "bridge and the `pi-extension/` package. Use `pi --extension iar-harness` "
        "from your project after running `iar serve`.",
        file=sys.stderr,
    )
    # If user asked for the offline driver we still support it.
    if args.driver != "stub":
        return 2
    from .orchestrator import run_loop
    program, log, hooks, enforcer = _load(args)

    class _Stub:
        def run_session(self, plan, enf):
            print(f"[stub] would run session: role={plan.role} hint={plan.hint_actions}")

    n = run_loop(enforcer, _Stub(), max_sessions=args.max_sessions)
    print(f"stub driver: {n} sessions planned")
    return 0


def cmd_next(args) -> int:
    """Print the currently eligible reactions as JSON."""
    program, log, hooks, enforcer = _load(args)
    print(json.dumps(enforcer.next_reactions(), indent=2))
    return 0


# --- entry point ------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="iar", description="Interpretable AutoResearch harness")
    p.add_argument("--agent-id", default=os.environ.get("IAR_AGENT_ID", "autoresearch"))
    sub = p.add_subparsers(dest="cmd", required=True)

    def _common(sp):
        sp.add_argument("--program", required=True, help="path to program.md")
        sp.add_argument("--events", required=True, help="path to events.jsonl")
        sp.add_argument("--hooks", default=None, help="optional path to hooks.py")

    sv = sub.add_parser("validate", help="replay-validate an existing events.jsonl")
    _common(sv)
    sv.add_argument("--scratch", default=None, help="if set, write the replay log here")
    sv.set_defaults(func=cmd_validate)

    rp = sub.add_parser("replay", help="like validate, but never returns failure exit code")
    _common(rp)
    rp.set_defaults(func=cmd_replay)
    rp.add_argument("--scratch", default=None)

    sr = sub.add_parser("serve", help="run the JSON-RPC bridge for the pi extension")
    _common(sr)
    sr.set_defaults(func=cmd_serve)

    rn = sub.add_parser("run", help="drive the loop locally")
    _common(rn)
    rn.add_argument("--driver", choices=["stub"], default="stub")
    rn.add_argument("--max-sessions", type=int, default=100)
    rn.set_defaults(func=cmd_run)

    nx = sub.add_parser("next", help="print eligible reactions")
    _common(nx)
    nx.set_defaults(func=cmd_next)

    return p


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except EnforcerError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
