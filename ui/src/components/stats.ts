import type { Run } from "../types.ts";
import type { DomainHandler } from "../interpret/handlers.ts";

export function renderStats(host: HTMLElement, run: Run, handler: DomainHandler): void {
  const container = document.createElement("div");
  container.className = "stats-row";
  
  const { stats } = run;
  
  const tiles = [
    {
      label: "Experiments",
      value: stats.totalExperiments.toString(),
      class: ""
    },
    {
      label: "Kept",
      value: stats.keptExperiments.toString(),
      class: "stat-tile__value--kept"
    },
    {
      label: "Discarded",
      value: stats.discardedExperiments.toString(),
      class: "stat-tile__value--discarded"
    },
    {
      label: "Crashed",
      value: stats.crashedExperiments.toString(),
      class: stats.crashedExperiments > 0 ? "stat-tile__value--crash" : ""
    },
    {
      label: `Best ${handler.metricLabel}`,
      value: handler.formatMetric(stats.currentBest),
      class: ""
    },
    {
      label: "Improvement",
      value: stats.improvementPercent > 0 
        ? `${stats.improvementPercent.toFixed(1)}%` 
        : "—",
      delta: stats.baselineValue 
        ? `from ${handler.formatMetric(stats.baselineValue)}`
        : undefined,
      class: stats.improvementPercent > 0 ? "stat-tile__value--improved" : ""
    }
  ];
  
  for (const tile of tiles) {
    const el = document.createElement("div");
    el.className = "stat-tile";
    el.innerHTML = `
      <div class="stat-tile__label">${tile.label}</div>
      <div class="stat-tile__value ${tile.class}">${tile.value}</div>
      ${tile.delta ? `<div class="stat-tile__delta">${tile.delta}</div>` : ""}
    `;
    container.appendChild(el);
  }
  
  host.appendChild(container);
}
