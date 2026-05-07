import { activeRun, store } from "../../state/store.ts";
import { clear, h } from "../dom.ts";
import type { UIEvent } from "../../data/projection.ts";
import type { UIReaction } from "../../data/program.ts";

export function renderInspector(host: HTMLElement): void {
  const render = () => {
    clear(host);
    host.classList.add("inspector");
    const s = store.get();
    const ar = activeRun();
    if (!ar) {
      host.appendChild(h("div", { class: "placeholder" }, ["no run selected"]));
      return;
    }
    const ev = s.selectedEventId ? ar.run.eventsById.get(s.selectedEventId) : null;
    if (!ev) {
      host.appendChild(
        h("div", { class: "placeholder" }, [
          "click an event in the stream or a dot on the chart to inspect it",
        ])
      );
      return;
    }

    host.appendChild(
      h("h3", {}, [
        ev.action,
        h("span", { class: "status-pill", style: "margin-left: 10px;" }, [ev.id]),
      ])
    );
    host.appendChild(renderEventCard(ev));

    const reaction = ev.reactionName
      ? ar.program.reactions.find((r) => r.name === ev.reactionName)
      : null;
    if (reaction) host.appendChild(renderReactionTrace(reaction, ev));

    host.appendChild(renderCausalChain(ev, ar.run.eventsById));

    if (ev.action === "Hypothesizing.formed") {
      const hyp = ar.run.hypotheses.find((h) => h.id === ev.id);
      if (hyp) host.appendChild(renderPredictionVsOutcome(hyp));
    } else if (ev.action === "Evaluating.measured") {
      // Link back to motivating hypothesis.
      const expId = ev.args["experiment_id"] as string | undefined;
      if (expId) {
        const exp = ar.run.experiments.find((e) => e.id === expId);
        if (exp?.hypothesisId) {
          const hyp = ar.run.hypotheses.find((h) => h.id === exp.hypothesisId);
          if (hyp) host.appendChild(renderPredictionVsOutcome(hyp));
        }
      }
    }
  };

  store.subscribe(render);
  render();
}

function renderEventCard(ev: UIEvent): HTMLElement {
  return h("section", { class: "panel" }, [
    h("h4", {}, ["Event"]),
    h("pre", { class: "json" }, [
      JSON.stringify(
        {
          event_id: ev.id,
          ts: ev.ts,
          by: ev.by,
          action: ev.action,
          args: ev.args,
          caused_by: ev.causedBy,
        },
        null,
        2
      ),
    ]),
  ]);
}

function renderReactionTrace(r: UIReaction, _ev: UIEvent): HTMLElement {
  return h("section", { class: "panel" }, [
    h("h4", {}, ["Reaction · ", r.name]),
    r.prose ? h("p", { style: "margin: 0 0 8px; color: var(--text-dim); font-size: 13px;" }, [r.prose]) : null,
    h("div", { class: "reaction" }, [
      h("span", { class: "label" }, ["when:\n"]),
      r.when + "\n",
      r.where ? h("span", { class: "label" }, ["where:\n"]) : null,
      r.where ? r.where + "\n" : "",
      h("span", { class: "label" }, ["then:\n"]),
      r.then,
    ].filter((x): x is string | HTMLElement => x !== null)),
  ]);
}

function renderCausalChain(
  ev: UIEvent,
  eventsById: Map<string, UIEvent>
): HTMLElement {
  // Walk caused_by upward, then forward through causes — small, contained chain.
  const upward: UIEvent[] = [];
  let cur: UIEvent | undefined = ev;
  const seen = new Set<string>();
  while (cur && cur.causedBy.length > 0 && upward.length < 6 && !seen.has(cur.id)) {
    seen.add(cur.id);
    const parent = eventsById.get(cur.causedBy[0]);
    if (!parent) break;
    upward.unshift(parent);
    cur = parent;
  }
  const downward: UIEvent[] = [];
  cur = ev;
  const seen2 = new Set<string>();
  while (cur && cur.causes.length > 0 && downward.length < 6 && !seen2.has(cur.id)) {
    seen2.add(cur.id);
    const child = eventsById.get(cur.causes[0]);
    if (!child) break;
    downward.push(child);
    cur = child;
  }

  const link = (e: UIEvent, isCurrent: boolean) =>
    h(
      "div",
      {
        class: `chain-link${isCurrent ? " current" : ""}`,
        on: { click: () => store.set({ selectedEventId: e.id }) },
      },
      [
        h("span", { class: "arrow" }, [isCurrent ? "▸" : "·"]),
        h("span", {}, [e.id]),
        h("span", {}, [e.action]),
      ]
    );

  return h("section", { class: "panel" }, [
    h("h4", {}, ["Causal chain"]),
    h(
      "div",
      { class: "chain" },
      [
        ...upward.map((p) => link(p, false)),
        link(ev, true),
        ...downward.map((d) => link(d, false)),
      ]
    ),
  ]);
}

interface HypLike {
  id: string;
  description: string;
  prediction: { direction?: string; magnitude?: string; mechanism?: string };
  measurementValue?: number;
  outcomeVsPrediction?: string;
  status: string;
}

function renderPredictionVsOutcome(h0: HypLike): HTMLElement {
  return h("section", { class: "panel" }, [
    h("h4", {}, ["Prediction vs outcome"]),
    h("div", { class: "pred-grid", style: "display:grid; grid-template-columns:1fr 1fr; gap:8px; font-family:var(--font-mono); font-size:12px;" }, [
      ...predRow("direction", h0.prediction.direction),
      ...predRow("magnitude", h0.prediction.magnitude),
      ...predRow("mechanism", h0.prediction.mechanism),
      ...predRow("measured", typeof h0.measurementValue === "number" ? h0.measurementValue.toFixed(4) : "—"),
    ]),
    h0.outcomeVsPrediction
      ? h("p", { style: "margin: 8px 0 0; color: var(--text-dim);" }, [h0.outcomeVsPrediction])
      : null,
    h("div", { style: "margin-top:8px;" }, [
      h("span", { class: `status-pill status-${h0.status}` }, [h0.status]),
    ]),
  ]);
}

function predRow(label: string, value?: string | number): HTMLElement[] {
  return [
    h("div", { style: "background:var(--bg); padding:4px 8px; border-radius:var(--r-sm);" }, [
      h("label", { style: "color:var(--text-muted); display:block; font-size:11px; font-family:var(--font-sans);" }, [label]),
      h("span", {}, [String(value ?? "—")]),
    ]),
  ];
}
