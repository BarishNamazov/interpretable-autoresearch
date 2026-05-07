import { activeRun, store } from "../state/store.ts";
import { clear, h } from "./dom.ts";

export function renderHypothesesTab(host: HTMLElement): void {
  const render = () => {
    clear(host);
    const ar = activeRun();
    if (!ar) {
      host.appendChild(h("div", { class: "placeholder" }, ["no run"]));
      return;
    }
    const s = store.get();
    const list = h("div", { class: "hyp-list" });
    for (const hyp of ar.run.hypotheses) {
      const valueText =
        typeof hyp.measurementValue === "number" ? hyp.measurementValue.toFixed(4) : "—";
      const card = h(
        "div",
        {
          class: `hyp-card${s.selectedEventId === hyp.id ? " selected" : ""}`,
          on: { click: () => store.set({ selectedEventId: hyp.id, tab: "inspector" }) },
        },
        [
          h("div", { class: "hyp-card-head" }, [
            h("span", { class: "desc" }, [hyp.description || "(no description)"]),
            h("span", { class: `status-pill status-${hyp.status}` }, [hyp.status]),
          ]),
          hyp.reasoning ? h("p", { class: "reasoning" }, [hyp.reasoning]) : null,
          h("div", { class: "pred-grid" }, [
            cell("direction", hyp.prediction.direction),
            cell("magnitude", hyp.prediction.magnitude),
            cell("mechanism", hyp.prediction.mechanism),
            cell("measured", valueText),
          ]),
          hyp.outcomeVsPrediction
            ? h("p", { class: "reasoning", style: "margin-top:8px;" }, [hyp.outcomeVsPrediction])
            : null,
        ]
      );
      list.appendChild(card);
    }
    if (ar.run.hypotheses.length === 0) {
      list.appendChild(h("div", { class: "placeholder" }, ["no hypotheses yet"]));
    }
    host.appendChild(list);
  };
  store.subscribe(render);
  render();
}

function cell(label: string, value?: string): HTMLElement {
  return h("div", {}, [
    h("label", {}, [label]),
    h("span", {}, [value || "—"]),
  ]);
}
