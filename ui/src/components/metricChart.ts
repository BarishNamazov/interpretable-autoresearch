import type { Run } from "../types.ts";
import type { DomainHandler } from "../interpret/handlers.ts";

export function renderMetricChart(host: HTMLElement, run: Run, handler: DomainHandler): void {
  const panel = document.createElement("section");
  panel.className = "panel metric-chart";
  
  const { metricSeries, discovery } = run;
  
  if (metricSeries.length === 0) {
    panel.innerHTML = `
      <div class="panel__header">
        <h2 class="panel__title">Metric Trajectory</h2>
      </div>
      <div class="loading">No measurements yet</div>
    `;
    host.appendChild(panel);
    return;
  }
  
  // Chart dimensions
  const width = 800;
  const height = 280;
  const margin = { top: 30, right: 30, bottom: 50, left: 70 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  
  // Data ranges
  const values = metricSeries.map(p => p.value);
  const minVal = Math.min(...values) * 0.95;
  const maxVal = Math.max(...values) * 1.05;
  
  // Scale functions
  const xScale = (i: number) => margin.left + (i / Math.max(metricSeries.length - 1, 1)) * chartWidth;
  const yScale = (v: number) => margin.top + chartHeight - ((v - minVal) / (maxVal - minVal)) * chartHeight;
  
  // Build noise floor band if available (perf-eng)
  let noiseFloorBand = "";
  if (discovery?.benchmark?.noiseFloor?.primaryMetricValueRuns?.length) {
    const runs = discovery.benchmark.noiseFloor.primaryMetricValueRuns;
    const nfMin = Math.min(...runs);
    const nfMax = Math.max(...runs);
    const nfMinY = yScale(nfMin);
    const nfMaxY = yScale(nfMax);
    noiseFloorBand = `<rect class="metric-chart__noise-band" x="${margin.left}" y="${nfMaxY}" width="${chartWidth}" height="${nfMinY - nfMaxY}" />`;
  }
  
  // Build grid lines
  const gridLines: string[] = [];
  const yTicks = 5;
  for (let i = 0; i <= yTicks; i++) {
    const v = minVal + (maxVal - minVal) * (i / yTicks);
    const y = yScale(v);
    gridLines.push(`<line class="metric-chart__grid-line" x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" />`);
    gridLines.push(`<text class="metric-chart__axis-label" x="${margin.left - 8}" y="${y + 3}" text-anchor="end">${handler.formatMetric(v)}</text>`);
  }
  
  // Build best-so-far line
  const bestLinePoints = metricSeries.map((p, i) => `${xScale(i)},${yScale(p.bestSoFar)}`).join(" ");
  
  // Build main line
  const mainLinePoints = metricSeries.map((p, i) => `${xScale(i)},${yScale(p.value)}`).join(" ");
  
  // Build points
  const points = metricSeries.map((p, i) => {
    const x = xScale(i);
    const y = yScale(p.value);
    const outcomeClass = getOutcomeClass(p.outcome);
    const shape = p.outcome === "kept" 
      ? `<circle cx="${x}" cy="${y}" r="6" class="metric-chart__point ${outcomeClass}" data-index="${i}" />`
      : `<circle cx="${x}" cy="${y}" r="5" class="metric-chart__point ${outcomeClass}" data-index="${i}" />`;
    return shape;
  }).join("");
  
  // X-axis labels
  const xLabels = metricSeries.map((p, i) => {
    const x = xScale(i);
    return `<text class="metric-chart__axis-label" x="${x}" y="${height - margin.bottom + 20}" text-anchor="middle">${p.experimentId}</text>`;
  }).join("");
  
  panel.innerHTML = `
    <div class="panel__header">
      <h2 class="panel__title">Metric Trajectory</h2>
      <span class="panel__badge">${handler.metricLabel} · ${handler.metricDirection === "lower_better" ? "↓ lower is better" : "↑ higher is better"}</span>
    </div>
    <svg class="metric-chart__svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">
      ${noiseFloorBand}
      ${gridLines.join("")}
      <polyline class="metric-chart__best-line" points="${bestLinePoints}" />
      <polyline class="metric-chart__main-line metric-chart__main-line--animated" points="${mainLinePoints}" />
      ${points}
      ${xLabels}
    </svg>
    <div class="metric-chart__tooltip" style="display: none;"></div>
  `;
  
  host.appendChild(panel);
  
  // Add interactivity
  const tooltip = panel.querySelector(".metric-chart__tooltip") as HTMLElement;
  const pointEls = panel.querySelectorAll(".metric-chart__point");
  
  pointEls.forEach((pointEl) => {
    pointEl.addEventListener("mouseenter", (e) => {
      const idx = parseInt((e.target as Element).getAttribute("data-index") || "0");
      const point = metricSeries[idx];
      if (!point) return;
      
      const rect = panel.getBoundingClientRect();
      const circleRect = (e.target as Element).getBoundingClientRect();
      
      tooltip.style.display = "block";
      tooltip.style.left = `${circleRect.left - rect.left + 15}px`;
      tooltip.style.top = `${circleRect.top - rect.top - 10}px`;
      
      const deltaText = point.delta !== undefined 
        ? `<div>Δ ${point.delta > 0 ? "+" : ""}${handler.formatMetric(point.delta)} (${point.deltaPercent!.toFixed(1)}%)</div>`
        : "";
      
      tooltip.innerHTML = `
        <div class="metric-chart__tooltip-title">${point.experimentId}: ${handler.formatMetric(point.value)}</div>
        ${deltaText}
        <div>Outcome: ${point.outcome}</div>
        ${point.hypothesis ? `<div class="metric-chart__tooltip-hyp">${point.hypothesis}</div>` : ""}
      `;
    });
    
    pointEl.addEventListener("mouseleave", () => {
      tooltip.style.display = "none";
    });
  });
}

function getOutcomeClass(outcome: string): string {
  switch (outcome) {
    case "kept": return "metric-chart__point--kept";
    case "discarded": return "metric-chart__point--discarded";
    case "crashed": return "metric-chart__point--crash";
    case "below_noise": return "metric-chart__point--below-noise";
    case "running": return "metric-chart__point--running";
    default: return "";
  }
}
