// Lightweight program.md parser for UI use. Mirrors the Python parser's
// structure but only extracts what the UI needs to render reactions and
// concept tooltips: concept names, action lists, and reaction prose +
// when/where/then text blocks (preserved verbatim).

export interface UIConcept {
  name: string;
  purpose: string;
  actions: string[];
}

export interface UIReaction {
  name: string;
  prose: string;
  when: string;
  where: string;
  then: string;
  /** Set of `Concept.verb` actions that appear in the `when:` clause. */
  whenActions: string[];
  /** Set of `Concept.verb` actions that appear in the `then:` clause. */
  thenActions: string[];
}

export interface UIProgram {
  title: string;
  concepts: UIConcept[];
  reactions: UIReaction[];
  /** Map from action (e.g. Hypothesizing.formed) → reaction.name that emits it. */
  actionToReaction: Map<string, string>;
}

const CONCEPT_HEADER_RE = /^####\s+`?([A-Z][A-Za-z]+)`?\b.*$/;
const REACTION_H4_RE = /^####\s+(R\d+)\b[\s\u2014\-:]+(.*)$/;
const ACTIONS_LINE_RE = /^\*\*Actions\.\*\*\s+(.*?)\s*$/;
const PURPOSE_LINE_RE = /^\*\*Purpose\.\*\*\s+(.*?)\s*$/;
const ACTION_TOK_RE = /[A-Z][A-Za-z]+\.[a-zA-Z_]+/g;

export function parseProgram(text: string): UIProgram {
  const lines = text.split("\n");
  let title = "Program";
  for (const ln of lines) {
    if (ln.startsWith("# ") && !ln.startsWith("## ")) {
      title = ln.slice(2).trim();
      break;
    }
  }

  // ---- concepts --------------------------------------------------------
  const concepts: UIConcept[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (REACTION_H4_RE.test(lines[i])) continue;
    const m = CONCEPT_HEADER_RE.exec(lines[i]);
    if (!m) continue;
    const name = m[1];
    let purpose = "";
    const actions: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const ln = lines[j];
      if (REACTION_H4_RE.test(ln)) break;
      if (CONCEPT_HEADER_RE.test(ln)) break;
      if (/^#{1,3}\s/.test(ln)) break;
      const pm = PURPOSE_LINE_RE.exec(ln);
      if (pm && !purpose) purpose = pm[1];
      const am = ACTIONS_LINE_RE.exec(ln);
      if (am) {
        for (const tok of am[1].split(/[,\s]+/)) {
          const cleaned = tok.replace(/[`.]/g, "").trim();
          if (/^[a-zA-Z_]\w*$/.test(cleaned)) actions.push(cleaned);
        }
      }
    }
    concepts.push({ name, purpose, actions });
  }
  if (!concepts.find((c) => c.name === "Requesting"))
    concepts.push({ name: "Requesting", purpose: "", actions: ["requested"] });
  if (!concepts.find((c) => c.name === "Freestyling"))
    concepts.push({ name: "Freestyling", purpose: "", actions: ["acted"] });

  // ---- reactions: walk fenced code blocks preceded by a #### Rn header ----
  const reactions: UIReaction[] = [];
  let i = 0;
  while (i < lines.length) {
    const fence = /^```/;
    if (!fence.test(lines[i])) {
      i++;
      continue;
    }
    const start = i;
    i++;
    const block: string[] = [];
    while (i < lines.length && !fence.test(lines[i])) {
      block.push(lines[i]);
      i++;
    }
    i++; // skip closing fence
    const body = block.join("\n");
    if (!/when:/i.test(body) || !/then:/i.test(body)) continue;
    // Walk back to find the reaction header.
    let name = `R${reactions.length}`;
    let prose = "";
    let blank = 0;
    for (let j = start - 1; j >= 0 && j >= start - 8; j--) {
      const ln = lines[j];
      if (!ln.trim()) {
        blank++;
        if (blank >= 2 && (name !== `R${reactions.length}` || prose)) break;
        continue;
      }
      blank = 0;
      const m = REACTION_H4_RE.exec(ln);
      if (m) {
        name = m[1];
        prose = m[2].trim().replace(/\.$/, "");
        break;
      }
      if (ln.trim().startsWith(">") && !prose) {
        prose = ln.replace(/^[\s>]+/, "").replace(/^\*+|\*+$/g, "").trim();
      }
    }
    const sections: { when: string; where: string; then: string } = {
      when: "",
      where: "",
      then: "",
    };
    let cur: keyof typeof sections | null = null;
    for (const raw of block) {
      const ln = raw.trim();
      const low = ln.toLowerCase();
      if (low.startsWith("when:")) {
        cur = "when";
        sections.when += ln.slice(5).trim() + "\n";
        continue;
      }
      if (low.startsWith("where:")) {
        cur = "where";
        sections.where += ln.slice(6).trim() + "\n";
        continue;
      }
      if (low.startsWith("then:")) {
        cur = "then";
        sections.then += ln.slice(5).trim() + "\n";
        continue;
      }
      if (cur) sections[cur] += ln + "\n";
    }
    const whenActions = Array.from(new Set(sections.when.match(ACTION_TOK_RE) ?? []));
    const thenActions = Array.from(new Set(sections.then.match(ACTION_TOK_RE) ?? []));
    reactions.push({
      name,
      prose,
      when: sections.when.trim(),
      where: sections.where.trim(),
      then: sections.then.trim(),
      whenActions,
      thenActions,
    });
  }

  const actionToReaction = new Map<string, string>();
  for (const r of reactions) {
    for (const a of r.thenActions) {
      // Past-tense form of the same verb is usually what's emitted; we map both.
      actionToReaction.set(a, r.name);
      const past = toPastTense(a);
      if (past) actionToReaction.set(past, r.name);
    }
  }

  return { title, concepts, reactions, actionToReaction };
}

function toPastTense(action: string): string | null {
  const ix = action.indexOf(".");
  if (ix < 0) return null;
  const concept = action.slice(0, ix);
  const verb = action.slice(ix + 1);
  const map: Record<string, string> = {
    form: "formed",
    apply: "applied",
    revert: "reverted",
    commit: "committed",
    run: "run",
    measure: "measured",
    record: "recorded",
    discover: "completed",
    profile: "profiled",
    surface: "surfaced",
  };
  return `${concept}.${map[verb] ?? verb}`;
}
