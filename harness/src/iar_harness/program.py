"""Parser for `program.md`: extracts concepts and reactions.

The program.md format is loose Markdown, but reactions are written inside
fenced code blocks with a stable `when:`/`where:`/`then:` shape. We parse
those blocks into structured `Reaction` objects so the reactor can match
them against the event log.

We deliberately keep the parser conservative: we do not attempt to parse
arbitrary clause syntax. Instead each clause is preserved as raw prose AND
classified into a small set of recognized patterns (e.g. an action match
in `when:`, a "no experiment is currently running" guard in `where:`).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable


# ---- Concept ---------------------------------------------------------------


@dataclass
class Concept:
    name: str
    purpose: str = ""
    actions: list[str] = field(default_factory=list)


# ---- Reaction --------------------------------------------------------------


@dataclass
class WhenClause:
    """One alternative in the `when:` line.

    Each WhenClause describes "an event of action ACTION whose args match
    these literal predicates was just appended". We keep only the action and
    optional literal arg predicates; richer semantics live in the reactor.
    """
    action: str
    bindings: dict[str, str] = field(default_factory=dict)
    raw: str = ""


@dataclass
class WhereGuard:
    """A guard line in `where:`. We classify the most common shapes."""
    raw: str
    kind: str = "free"  # one of: "free", "no_running_experiment", "value_lt_best", "value_gte_best", "no_recorded_metric", "is_crashed"


@dataclass
class ThenStep:
    """A step in the `then:` block.

    `kind` is "request" or "attest". `action` is e.g. "Hypothesizing.form"
    (request, infinitive) or "Hypothesizing.formed" (attest, past tense).
    """
    kind: str
    action: str
    raw: str


@dataclass
class Reaction:
    name: str
    prose: str
    when: list[WhenClause]
    where: list[WhereGuard]
    then: list[ThenStep]


@dataclass
class Program:
    title: str
    concepts: list[Concept]
    reactions: list[Reaction]
    raw: str

    def concept(self, name: str) -> Concept | None:
        for c in self.concepts:
            if c.name == name:
                return c
        return None

    def reaction(self, name: str) -> Reaction | None:
        for r in self.reactions:
            if r.name == name:
                return r
        return None

    @property
    def concept_names(self) -> list[str]:
        return [c.name for c in self.concepts]

    @property
    def actions(self) -> list[str]:
        out: list[str] = []
        for c in self.concepts:
            for a in c.actions:
                out.append(f"{c.name}.{a}")
        return out


# ---- Parsing primitives ----------------------------------------------------

_FENCE_RE = re.compile(r"^```(?:\w+)?\s*$")
_HEADING_RE = re.compile(r"^(#{1,6})\s+(.*?)\s*$")
_REACTION_HEADER_RE = re.compile(r"^(R\d+|R0)\b[\s\u2014\-:]+(.*)$")
_CONCEPT_HEADER_RE = re.compile(r"^####\s+`?([A-Z][A-Za-z]+)`?\b.*$")
# Reaction headers under `####` start with a name like "R0", "R1", etc.
# We must NOT confuse them with concept headers.
_REACTION_H4_RE = re.compile(r"^####\s+(R\d+)\b[\s\u2014\-:]+(.*)$")
_ACTIONS_LINE_RE = re.compile(r"^\*\*Actions\.\*\*\s+(.*?)\s*$")
_PURPOSE_LINE_RE = re.compile(r"^\*\*Purpose\.\*\*\s+(.*?)\s*$")


def _split_top_level(line: str, sep: str) -> list[str]:
    """Split on `sep` but ignore separators inside parentheses."""
    out: list[str] = []
    depth = 0
    buf = ""
    i = 0
    while i < len(line):
        ch = line[i]
        if ch == "(":
            depth += 1
            buf += ch
        elif ch == ")":
            depth = max(0, depth - 1)
            buf += ch
        elif depth == 0 and line[i : i + len(sep)] == sep:
            out.append(buf.strip())
            buf = ""
            i += len(sep)
            continue
        else:
            buf += ch
        i += 1
    if buf.strip():
        out.append(buf.strip())
    return out


_ACTION_CALL_RE = re.compile(r"^([A-Z][A-Za-z]+\.[a-zA-Z_]+)\s*(?:\((.*)\))?\s*$")


def _parse_when_atom(text: str) -> WhenClause | None:
    text = text.strip()
    if not text:
        return None
    m = _ACTION_CALL_RE.match(text)
    if not m:
        # Best-effort: keep the raw text, no action.
        return WhenClause(action="", raw=text)
    action = m.group(1)
    args_blob = (m.group(2) or "").strip()
    bindings: dict[str, str] = {}
    if args_blob:
        # Parse "?prev" or "key: ?prev, key2: literal" loosely.
        for piece in _split_top_level(args_blob, ","):
            piece = piece.strip()
            if ":" in piece:
                k, v = piece.split(":", 1)
                bindings[k.strip()] = v.strip()
            else:
                # Positional binding — store under a synthetic key.
                bindings.setdefault("_args", "")
                bindings["_args"] = (bindings["_args"] + " " + piece).strip()
    return WhenClause(action=action, bindings=bindings, raw=text)


def _parse_when_block(body: str) -> list[WhenClause]:
    # Body may be one line or many; alternatives are joined by "OR".
    flat = " ".join(line.strip() for line in body.splitlines() if line.strip())
    parts = re.split(r"\s+OR\s+", flat)
    out: list[WhenClause] = []
    for p in parts:
        atom = _parse_when_atom(p)
        if atom is not None:
            out.append(atom)
    return out


def _classify_where(text: str) -> WhereGuard:
    t = text.lower()
    if "no experiment is currently running" in t:
        return WhereGuard(raw=text, kind="no_running_experiment")
    if "?value < ?best" in t or "value < best" in t or "value < ?best" in t:
        return WhereGuard(raw=text, kind="value_lt_best")
    if "?value >= ?best" in t or "value >= best" in t or "value >= ?best" in t:
        return WhereGuard(raw=text, kind="value_gte_best")
    if "no recorded" in t and "metric" in t:
        return WhereGuard(raw=text, kind="no_recorded_metric")
    if "marked as crashed" in t or "is crashed" in t or "crashed" in t and "marked" in t:
        return WhereGuard(raw=text, kind="is_crashed")
    return WhereGuard(raw=text, kind="free")


def _parse_where_block(body: str) -> list[WhereGuard]:
    guards: list[WhereGuard] = []
    for line in body.splitlines():
        line = line.strip()
        if not line:
            continue
        guards.append(_classify_where(line))
    return guards


def _parse_then_block(body: str) -> list[ThenStep]:
    steps: list[ThenStep] = []
    for line in body.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.lower().startswith("request "):
            rest = line[len("request "):].strip()
            m = _ACTION_CALL_RE.match(rest)
            action = m.group(1) if m else rest
            steps.append(ThenStep(kind="request", action=action, raw=line))
        else:
            m = _ACTION_CALL_RE.match(line)
            action = m.group(1) if m else line
            steps.append(ThenStep(kind="attest", action=action, raw=line))
    return steps


def _parse_reaction_block(body: str) -> tuple[list[WhenClause], list[WhereGuard], list[ThenStep]]:
    """Parse a fenced reaction block into (when, where, then)."""
    sections: dict[str, list[str]] = {"when": [], "where": [], "then": []}
    current: str | None = None
    for line in body.splitlines():
        stripped = line.strip()
        low = stripped.lower()
        if low.startswith("when:"):
            current = "when"
            tail = stripped[5:].strip()
            if tail:
                sections[current].append(tail)
            continue
        if low.startswith("where:"):
            current = "where"
            tail = stripped[6:].strip()
            if tail:
                sections[current].append(tail)
            continue
        if low.startswith("then:"):
            current = "then"
            tail = stripped[5:].strip()
            if tail:
                sections[current].append(tail)
            continue
        if current is not None:
            sections[current].append(line)
    when = _parse_when_block("\n".join(sections["when"]))
    where = _parse_where_block("\n".join(sections["where"]))
    then = _parse_then_block("\n".join(sections["then"]))
    return when, where, then


def _iter_blocks(text: str) -> Iterable[tuple[int, list[str], list[str]]]:
    """Yield (start_line_idx, header_lines_before_block, block_lines) for each fenced block.

    `header_lines_before_block` is the run of non-blank lines immediately
    preceding the block (used to recover the reaction title).
    """
    lines = text.splitlines()
    i = 0
    n = len(lines)
    while i < n:
        if _FENCE_RE.match(lines[i]):
            start = i
            i += 1
            block: list[str] = []
            while i < n and not _FENCE_RE.match(lines[i]):
                block.append(lines[i])
                i += 1
            # Walk back collecting preceding non-blank lines (up to 6).
            header: list[str] = []
            j = start - 1
            blanks = 0
            while j >= 0 and len(header) < 8:
                ln = lines[j]
                if not ln.strip():
                    blanks += 1
                    if blanks >= 2 and header:
                        break
                else:
                    blanks = 0
                    header.append(ln)
                j -= 1
            header.reverse()
            yield start, header, block
            i += 1  # skip closing fence
        else:
            i += 1


# ---- Top-level parse -------------------------------------------------------


def parse_program(text: str) -> Program:
    """Parse a program.md into a `Program`.

    The parser is robust to the existing `model-training/program.md` and
    `performance-engineering/program.md` shapes.
    """
    title = "Program"
    for ln in text.splitlines():
        m = _HEADING_RE.match(ln)
        if m and m.group(1) == "#":
            title = m.group(2).strip()
            break

    # ---- Concepts ---------------------------------------------------------
    concepts: list[Concept] = []
    lines = text.splitlines()
    i = 0
    while i < len(lines):
        # Skip reaction headers like "#### R0 — ...".
        if _REACTION_H4_RE.match(lines[i]):
            i += 1
            continue
        m = _CONCEPT_HEADER_RE.match(lines[i])
        if m:
            name = m.group(1)
            purpose = ""
            actions: list[str] = []
            j = i + 1
            # Walk forward until the next concept/section header or large gap.
            while j < len(lines):
                ln = lines[j]
                if _CONCEPT_HEADER_RE.match(ln):
                    break
                if _HEADING_RE.match(ln) and ln.startswith(("# ", "## ", "### ")):
                    break
                pm = _PURPOSE_LINE_RE.match(ln)
                if pm and not purpose:
                    purpose = pm.group(1)
                am = _ACTIONS_LINE_RE.match(ln)
                if am:
                    raw = am.group(1)
                    for tok in re.split(r"[,\s]+", raw):
                        tok = tok.strip().strip("`.")
                        if tok and tok.isidentifier():
                            actions.append(tok)
                j += 1
            concepts.append(Concept(name=name, purpose=purpose, actions=actions))
            i = j
            continue
        i += 1

    # Always make sure Requesting and Freestyling are known concepts even if
    # not declared in the program (they're harness-level conventions).
    declared = {c.name for c in concepts}
    if "Requesting" not in declared:
        concepts.append(Concept(name="Requesting", actions=["requested"]))
    if "Freestyling" not in declared:
        concepts.append(Concept(name="Freestyling", actions=["acted"]))

    # ---- Reactions --------------------------------------------------------
    reactions: list[Reaction] = []
    for _start, header_lines, block_lines in _iter_blocks(text):
        body = "\n".join(block_lines)
        if "when:" not in body.lower() or "then:" not in body.lower():
            continue
        when, where, then = _parse_reaction_block(body)
        if not when or not then:
            continue
        # Pull a name + prose out of headers preceding the block.
        name = ""
        prose = ""
        for h in header_lines:
            m = _REACTION_HEADER_RE.search(h.lstrip("#").strip())
            if m:
                name = m.group(1)
                prose = m.group(2).strip().rstrip(".")
                break
        if not name:
            # Fallback synthetic name.
            name = f"R{len(reactions)}"
        # Also pick up a blockquote prose line if present.
        if not prose:
            for h in header_lines:
                if h.strip().startswith(">"):
                    prose = h.strip().lstrip(">").strip().strip("*")
                    break
        reactions.append(Reaction(name=name, prose=prose, when=when, where=where, then=then))

    return Program(title=title, concepts=concepts, reactions=reactions, raw=text)


def load_program(path: str | Path) -> Program:
    return parse_program(Path(path).read_text(encoding="utf-8"))


__all__ = [
    "Program",
    "Concept",
    "Reaction",
    "WhenClause",
    "WhereGuard",
    "ThenStep",
    "parse_program",
    "load_program",
]
