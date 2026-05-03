import type { Domain, Run, ApiResponse } from "../types.ts";
import { parseEvents } from "../parse.ts";
import { interpret, getHandler } from "../interpret/index.ts";
import type { PanelType } from "../interpret/handlers.ts";

import { renderHeader } from "./header.ts";
import { renderDomainSwitcher } from "./domainSwitcher.ts";
import { renderStats } from "./stats.ts";
import { renderMetricChart } from "./metricChart.ts";
import { renderProvenanceTimeline } from "./provenanceTimeline.ts";
import { renderExperimentList } from "./experimentList.ts";
import { renderHypothesisGrid } from "./hypothesisGrid.ts";
import { renderProfilingPanel } from "./profilingPanel.ts";
import { renderDiscoveryPanel } from "./discoveryPanel.ts";
import { renderCommunications } from "./communications.ts";
import { renderEventStream } from "./eventStream.ts";

interface AppState {
  currentDomain: Domain;
  runs: Map<Domain, Run>;
  rawData: ApiResponse | null;
}

const state: AppState = {
  currentDomain: "performance-engineering",
  runs: new Map(),
  rawData: null
};

export async function initApp(container: HTMLElement): Promise<void> {
  // Show loading state
  container.innerHTML = `<div class="loading">Loading event data...</div>`;

  try {
    const response = await fetch("/runs.json");
    // // Fetch data
    // let response = await fetch("/api/runs");
    // if (!response.ok) {
    //   // Static deployment fallback: pre-built runs.json next to index.html
    //   response = await fetch("./runs.json");
    // }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    state.rawData = await response.json() as ApiResponse;

    // Parse and interpret both domains
    for (const domain of ["model-training", "performance-engineering"] as Domain[]) {
      const data = state.rawData[domain];
      if (data?.events) {
        const rawEvents = parseEvents(data.events);
        const run = interpret(domain, rawEvents);
        state.runs.set(domain, run);
      }
    }

    // Default to performance-engineering if it has data, otherwise model-training
    if (state.runs.has("performance-engineering")) {
      state.currentDomain = "performance-engineering";
    } else if (state.runs.has("model-training")) {
      state.currentDomain = "model-training";
    }

    // Render the app
    render(container);

  } catch (err) {
    console.error("Failed to load data:", err);
    container.innerHTML = `
      <div class="loading" style="color: var(--accent-crash);">
        Failed to load event data. Make sure the server is running and data files exist.
      </div>
    `;
  }
}

function render(container: HTMLElement): void {
  container.innerHTML = "";

  const run = state.runs.get(state.currentDomain);
  if (!run) {
    container.innerHTML = `<div class="loading">No data for ${state.currentDomain}</div>`;
    return;
  }

  const handler = getHandler(state.currentDomain);

  // Header
  renderHeader(container, run.agentId, handler.label);

  // Domain switcher
  renderDomainSwitcher(container, state.currentDomain, (domain) => {
    state.currentDomain = domain;
    render(container);
  });

  // Render panels based on handler config
  const panelsContainer = document.createElement("div");
  panelsContainer.className = "panels-grid";
  container.appendChild(panelsContainer);

  for (const panelType of handler.panels) {
    renderPanel(panelsContainer, panelType, run, handler);
  }
}

function renderPanel(
  container: HTMLElement,
  panelType: PanelType,
  run: Run,
  handler: ReturnType<typeof getHandler>
): void {
  switch (panelType) {
    case "discovery":
      if (run.discovery) {
        renderDiscoveryPanel(container, run, handler);
      }
      break;

    case "stats":
      renderStats(container, run, handler);
      break;

    case "metricChart":
      renderMetricChart(container, run, handler);
      break;

    case "provenance":
      renderProvenanceTimeline(container, run);
      break;

    case "experiments":
      renderExperimentList(container, run, handler);
      break;

    case "hypotheses":
      renderHypothesisGrid(container, run);
      break;

    case "profiling":
      if (run.profiles && run.profiles.length > 0) {
        renderProfilingPanel(container, run);
      }
      break;

    case "communications":
      if (run.communications.length > 0) {
        renderCommunications(container, run);
      }
      break;

    case "eventStream":
      renderEventStream(container, run);
      break;
  }
}
