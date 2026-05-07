import { activeRun, store } from "../state/store.ts";
import { clear, h } from "./dom.ts";

export function renderRunHeader(host: HTMLElement): void {
  const render = () => {
    clear(host);
    const s = store.get();
    const ar = activeRun();
    const runIds = Object.keys(s.runs);
    const select = h(
      "select",
      {
        on: {
          change: (e: Event) => {
            const id = (e.target as HTMLSelectElement).value;
            store.set({ runId: id, selectedEventId: null });
          },
        },
      },
      runIds.map((id) =>
        h(
          "option",
          { value: id, selected: id === s.runId },
          [id]
        )
      )
    );
    const titleText = ar?.program.title ?? "Interpretable AutoResearch";
    const stats = ar
      ? `${ar.run.events.length} events · ${ar.run.hypotheses.length} hypotheses · ${ar.run.experiments.length} experiments`
      : "";
    host.appendChild(
      h("h1", {}, [titleText, h("small", {}, [stats])])
    );
    host.appendChild(
      h("div", { class: "controls" }, [
        h("label", { style: "color: var(--text-muted); font-size: 12px;" }, ["run"]),
        select,
      ])
    );
  };
  store.subscribe(render);
  render();
}
