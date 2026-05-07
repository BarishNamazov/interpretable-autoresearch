import { loadRuns } from "../data/api.ts";
import { parseEventsStrict } from "../data/parse.ts";
import { parseProgram } from "../data/program.ts";
import { projectRun } from "../data/projection.ts";
import { store } from "../state/store.ts";
import { renderEventStream } from "./EventStream.ts";
import { renderHypothesesTab } from "./HypothesesTab.ts";
import { renderInsightsTab } from "./InsightsTab.ts";
import { renderInspector } from "./inspector/Inspector.ts";
import { renderMetricChart } from "./MetricChart.ts";
import { renderRunHeader } from "./RunHeader.ts";
import { clear, h } from "./dom.ts";

export async function initApp(root: HTMLElement): Promise<void> {
  clear(root);
  // Skeleton
  const header = h("header", { class: "app-header" });
  const left = h("div", { class: "left-pane" });
  const right = h("div", { class: "right-pane" });
  root.appendChild(header);
  root.appendChild(left);
  root.appendChild(right);

  const metricSlot = h("div");
  const streamSlot = h("div");
  left.appendChild(metricSlot);
  left.appendChild(streamSlot);

  const tabs = h("div", { class: "tabs" }, [
    tabButton("inspector", "Inspector"),
    tabButton("hypotheses", "Hypotheses"),
    tabButton("insights", "Insights"),
  ]);
  const tabBody = h("div", { class: "tab-body" });
  right.appendChild(tabs);
  right.appendChild(tabBody);

  // Wire components
  renderRunHeader(header);
  renderMetricChart(metricSlot);
  renderEventStream(streamSlot);

  // Tab body switches based on store.tab
  const inspectorHost = h("div");
  const hypHost = h("div");
  const insHost = h("div");
  renderInspector(inspectorHost);
  renderHypothesesTab(hypHost);
  renderInsightsTab(insHost);

  const renderTab = () => {
    clear(tabBody);
    const t = store.get().tab;
    if (t === "inspector") tabBody.appendChild(inspectorHost);
    else if (t === "hypotheses") tabBody.appendChild(hypHost);
    else tabBody.appendChild(insHost);
    for (const b of tabs.querySelectorAll("button")) {
      b.classList.toggle("active", (b as HTMLButtonElement).dataset.tab === t);
    }
  };
  store.subscribe(renderTab);

  // Wire selecting an event from anywhere → switch to inspector tab.
  let lastSel: string | null = null;
  store.subscribe((s) => {
    if (s.selectedEventId && s.selectedEventId !== lastSel && s.tab !== "inspector") {
      store.set({ tab: "inspector" });
    }
    lastSel = s.selectedEventId;
  });

  // Load data
  try {
    const data = await loadRuns();
    const runs: typeof store.get extends () => infer S ? (S extends { runs: infer R } ? R : never) : never = {} as never;
    void runs;
    const next: Record<string, { run: ReturnType<typeof projectRun>; program: ReturnType<typeof parseProgram> }> = {};
    for (const [id, domain] of Object.entries(data)) {
      const program = parseProgram(domain.program ?? "");
      const { events, errors } = parseEventsStrict(domain.events ?? "");
      if (errors.length) console.warn(`[${id}] ${errors.length} parse errors`, errors);
      const run = projectRun(events, program.actionToReaction);
      next[id] = { run, program };
    }
    const firstId = Object.keys(next)[0] ?? null;
    store.set({ runs: next, runId: firstId, loading: false, error: null });
    renderTab();
  } catch (e) {
    store.set({ loading: false, error: (e as Error).message });
    root.appendChild(h("div", { class: "notice error" }, [`failed to load: ${(e as Error).message}`]));
  }
}

function tabButton(id: "inspector" | "hypotheses" | "insights", label: string): HTMLButtonElement {
  return h(
    "button",
    {
      dataset: { tab: id },
      on: { click: () => store.set({ tab: id }) },
    },
    [label]
  );
}
