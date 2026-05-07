"""JSON-RPC bridge: exposes the Enforcer over stdio so the pi extension can
call into Python without itself implementing the harness."""
from __future__ import annotations

import json
import sys
import traceback
from typing import Any

from .enforcer import Enforcer, EnforcerError


class PiBridge:
    """Newline-delimited JSON-RPC server, stdin/stdout."""

    def __init__(self, enforcer: Enforcer):
        self.enforcer = enforcer
        self._handlers = {
            "tail_events": self._tail_events,
            "next_reactions": self._next_reactions,
            "request": self._request,
            "attest": self._attest,
            "ping": self._ping,
        }

    # ---- handlers ---------------------------------------------------------
    def _ping(self, params: dict[str, Any]) -> dict[str, Any]:
        return {"ok": True}

    def _tail_events(self, params: dict[str, Any]) -> dict[str, Any]:
        n = int(params.get("n", 20))
        return {"events": self.enforcer.tail_events(n)}

    def _next_reactions(self, params: dict[str, Any]) -> dict[str, Any]:
        return {"reactions": self.enforcer.next_reactions()}

    def _request(self, params: dict[str, Any]) -> dict[str, Any]:
        action = params["action"]
        args = params.get("args") or {}
        caused_by = params.get("caused_by") or []
        result, canonical = self.enforcer.request(
            action, args=args, caused_by=caused_by, force=bool(params.get("force"))
        )
        return {
            "event": result.event.to_dict(),
            "warnings": result.warnings,
            "canonical_args": canonical,
        }

    def _attest(self, params: dict[str, Any]) -> dict[str, Any]:
        action = params["action"]
        args = params.get("args") or {}
        caused_by = params.get("caused_by") or []
        result = self.enforcer.attest(
            action, args=args, caused_by=caused_by, force=bool(params.get("force"))
        )
        return {"event": result.event.to_dict(), "warnings": result.warnings}

    # ---- loop -------------------------------------------------------------
    def serve(self, in_stream=None, out_stream=None) -> None:
        in_stream = in_stream or sys.stdin
        out_stream = out_stream or sys.stdout
        for raw in in_stream:
            raw = raw.strip()
            if not raw:
                continue
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError as e:
                self._reply(out_stream, None, error=f"invalid json: {e}")
                continue
            req_id = msg.get("id")
            method = msg.get("method")
            params = msg.get("params") or {}
            handler = self._handlers.get(method)
            if handler is None:
                self._reply(out_stream, req_id, error=f"unknown method: {method}")
                continue
            try:
                result = handler(params)
                self._reply(out_stream, req_id, result=result)
            except EnforcerError as e:
                self._reply(out_stream, req_id, error=f"EnforcerError: {e}")
            except Exception as e:  # pragma: no cover - defensive
                tb = traceback.format_exc()
                self._reply(out_stream, req_id, error=f"{type(e).__name__}: {e}\n{tb}")

    def _reply(self, out, req_id, *, result=None, error=None) -> None:
        msg: dict[str, Any] = {"id": req_id}
        if error is not None:
            msg["error"] = error
        else:
            msg["result"] = result
        out.write(json.dumps(msg) + "\n")
        out.flush()


__all__ = ["PiBridge"]
