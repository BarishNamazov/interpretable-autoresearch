import type { Run, Discovery } from "../types.ts";
import type { DomainHandler } from "../interpret/handlers.ts";

export function renderDiscoveryPanel(host: HTMLElement, run: Run, handler: DomainHandler): void {
  if (!run.discovery) return;
  
  const panel = document.createElement("section");
  panel.className = "panel discovery-panel";
  
  const discovery = run.discovery;
  
  panel.innerHTML = `
    <div class="panel__header">
      <h2 class="panel__title">Discovery</h2>
      <span class="panel__badge">Codebase analysis</span>
    </div>
    <div class="discovery-panel__content">
      ${renderCodebaseMap(discovery)}
      ${renderHotPath(discovery)}
      ${renderBenchmark(discovery, handler)}
      ${renderNoiseFloor(discovery, handler)}
      ${renderOpenQuestions(discovery)}
    </div>
  `;
  
  host.appendChild(panel);
}

function renderCodebaseMap(discovery: Discovery): string {
  const modules = discovery.codebaseMap.moduleSummaries;
  if (modules.length === 0) return "";
  
  const moduleCards = modules.map(mod => `
    <div class="discovery-module">
      <div class="discovery-module__path">${escapeHtml(mod.path)}</div>
      <div class="discovery-module__summary">${escapeHtml(mod.summary)}</div>
    </div>
  `).join("");
  
  return `
    <div class="discovery-section">
      <h3 class="discovery-section__title">Codebase Map</h3>
      <div class="discovery-modules">${moduleCards}</div>
    </div>
  `;
}

function renderHotPath(discovery: Discovery): string {
  const hp = discovery.hotPathHypothesis;
  if (!hp.description) return "";
  
  return `
    <div class="discovery-section">
      <h3 class="discovery-section__title">Hot Path Hypothesis</h3>
      <div class="discovery-hot-path">
        <div class="discovery-hot-path__description">${escapeHtml(hp.description)}</div>
        <div class="discovery-hot-path__reasoning">${escapeHtml(hp.reasoning)}</div>
      </div>
    </div>
  `;
}

function renderBenchmark(discovery: Discovery, _handler: DomainHandler): string {
  const bm = discovery.benchmark;
  
  return `
    <div class="discovery-section">
      <h3 class="discovery-section__title">Benchmark</h3>
      <div class="discovery-module">
        <div class="discovery-module__path">${escapeHtml(bm.path)}</div>
        <div class="discovery-module__summary">
          Origin: ${bm.origin} · 
          Primary: ${bm.primaryMetric.key} (${bm.primaryMetric.direction === "lower_better" ? "↓ lower is better" : "↑ higher is better"})
        </div>
      </div>
    </div>
  `;
}

function renderNoiseFloor(discovery: Discovery, handler: DomainHandler): string {
  const nf = discovery.benchmark.noiseFloor;
  const runs = nf.primaryMetricValueRuns;
  
  if (runs.length === 0) return "";
  
  const minVal = Math.min(...runs);
  const maxVal = Math.max(...runs);
  const range = maxVal - minVal || 1;
  
  // Normalize positions to 0-100%
  const points = runs.map(v => ((v - minVal) / range) * 80 + 10);
  
  const pointDots = points.map((pct, i) => `
    <div class="discovery-noise-floor__point" style="left: ${pct}%;" title="${handler.formatMetric(runs[i])}"></div>
  `).join("");
  
  const bandLeft = Math.min(...points);
  const bandRight = 100 - Math.max(...points);
  
  return `
    <div class="discovery-section">
      <h3 class="discovery-section__title">Noise Floor</h3>
      <div class="discovery-noise-floor">
        <div class="discovery-noise-floor__diagram">
          <div class="discovery-noise-floor__band" style="left: ${bandLeft}%; right: ${bandRight}%;"></div>
          ${pointDots}
        </div>
        <div class="discovery-noise-floor__label">
          Spread: ${nf.spreadPct.toFixed(2)}%<br>
          Range: ${handler.formatMetric(minVal)} – ${handler.formatMetric(maxVal)}
        </div>
      </div>
    </div>
  `;
}

function renderOpenQuestions(discovery: Discovery): string {
  const questions = discovery.openQuestions;
  if (questions.length === 0) return "";
  
  const questionItems = questions.map(q => `
    <li class="discovery-question">${escapeHtml(q)}</li>
  `).join("");
  
  return `
    <div class="discovery-section">
      <h3 class="discovery-section__title">Open Questions</h3>
      <ul class="discovery-questions">${questionItems}</ul>
    </div>
  `;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
