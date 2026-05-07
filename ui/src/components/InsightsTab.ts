import { activeRun, store } from "../state/store.ts";
import { deriveInsights } from "../data/insights.ts";
import { clear, h } from "./dom.ts";

export function renderInsightsTab(host: HTMLElement): void {
  const render = () => {
    clear(host);
    const ar = activeRun();
    if (!ar) {
      host.appendChild(h("div", { class: "placeholder" }, ["no run"]));
      return;
    }
    const ins = deriveInsights(ar.run);
    const grid = h("div", { class: "insights-grid" });

    grid.appendChild(
      h("div", { class: "insight-card" }, [
        h("h4", {}, ["Hypothesis discipline"]),
        h("div", { class: "stats" }, [
          stat(ins.stats.totalHypotheses, "total"),
          stat(ins.stats.confirmed, "confirmed"),
          stat(ins.stats.violated, "violated"),
          stat(ins.stats.partial, "partial"),
          stat(ins.stats.pending, "pending"),
          stat(ins.stats.discarded, "discarded"),
          stat(`${(ins.stats.hitRate * 100).toFixed(0)}%`, "hit rate"),
        ]),
      ])
    );

    grid.appendChild(
      h("div", { class: "insight-card" }, [
        h("h4", {}, ["Themes"]),
        ins.themes.length
          ? h(
              "ul",
              {},
              ins.themes.map((t) =>
                h("li", {}, [
                  h("b", {}, [t.theme]),
                  ` — ${t.confirmed}/${t.confirmed + t.violated + t.partial} confirmed (`,
                  `${t.violated} violated, ${t.partial} partial)`,
                ])
              )
            )
          : h("div", { class: "empty" }, ["not enough hypotheses to surface themes yet"]),
      ])
    );

    if (ins.noiseFloor) {
      grid.appendChild(
        h("div", { class: "insight-card" }, [
          h("h4", {}, ["Noise floor cross-checks"]),
          h("p", { style: "margin: 0 0 4px;" }, [
            `${ins.noiseFloor.declaredAboveNoiseButRegression} 'wins' the agent claimed above noise but the data says below.`,
          ]),
          h(
            "ul",
            {},
            ins.noiseFloor.pairs.slice(0, 5).map((p) => h("li", {}, [p.valDelta]))
          ),
        ])
      );
    }

    if (ins.freestyleSummary.count > 0) {
      grid.appendChild(
        h("div", { class: "insight-card" }, [
          h("h4", {}, ["Freestyle"]),
          h("p", {}, [
            `${ins.freestyleSummary.count} off-script event(s) — these bypass the structured reactions.`,
          ]),
          ins.freestyleSummary.reasons.length
            ? h(
                "ul",
                {},
                ins.freestyleSummary.reasons.map((r) => h("li", {}, [r]))
              )
            : null,
        ])
      );
    }

    if (ar.run.warnings.length > 0) {
      grid.appendChild(
        h("div", { class: "insight-card" }, [
          h("h4", {}, ["Hook warnings"]),
          h(
            "ul",
            {},
            ar.run.warnings.slice(0, 8).map((w) => h("li", {}, [w]))
          ),
        ])
      );
    }

    host.appendChild(grid);
  };
  store.subscribe(render);
  render();
}

function stat(value: number | string, label: string): HTMLElement {
  return h("div", { class: "stat" }, [
    h("b", {}, [String(value)]),
    h("span", {}, [label]),
  ]);
}
