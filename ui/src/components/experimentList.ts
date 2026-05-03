import type { Run, Experiment } from "../types.ts";
import type { DomainHandler } from "../interpret/handlers.ts";

export function renderExperimentList(host: HTMLElement, run: Run, handler: DomainHandler): void {
  const panel = document.createElement("section");
  panel.className = "panel";
  
  const { experiments } = run;
  
  panel.innerHTML = `
    <div class="panel__header">
      <h2 class="panel__title">Experiments</h2>
      <span class="panel__badge">${experiments.length} total</span>
    </div>
    <div class="experiments-grid"></div>
  `;
  
  const grid = panel.querySelector(".experiments-grid") as HTMLElement;
  
  for (let i = 0; i < experiments.length; i++) {
    const exp = experiments[i];
    const card = renderExperimentCard(exp, handler, i);
    grid.appendChild(card);
  }
  
  host.appendChild(panel);
}

function renderExperimentCard(exp: Experiment, handler: DomainHandler, index: number): HTMLElement {
  const card = document.createElement("div");
  card.className = `experiment-card experiment-card--${exp.outcome}`;
  card.style.animationDelay = `${0.4 + index * 0.05}s`;
  
  const metricValue = exp.measurement?.primary?.value;
  const metricDisplay = metricValue !== undefined ? handler.formatMetric(metricValue) : "—";
  
  // Description
  const description = exp.description || exp.hypothesis?.description || "Baseline";
  
  // Prediction info
  let predictionHtml = "";
  if (exp.hypothesis?.prediction) {
    const pred = exp.hypothesis.prediction;
    predictionHtml = `
      <div class="experiment-card__prediction">
        <span class="experiment-card__prediction-label">Prediction: </span>
        ${pred.direction}${pred.magnitude ? `, ${pred.magnitude}` : ""}
      </div>
    `;
  }
  
  // Prediction range diagram
  let rangeHtml = "";
  if (exp.hypothesis?.prediction?.magnitude && metricValue !== undefined) {
    rangeHtml = renderPredictionRange(exp, metricValue);
  }
  
  // Outcome text
  const outcomeText = getOutcomeText(exp.outcome, exp.outcomeReason);
  const outcomeClass = `experiment-card__outcome--${exp.outcome}`;
  
  // Commit sha
  const commitDisplay = exp.commitSha ? exp.commitSha.slice(0, 7) : "";
  
  card.innerHTML = `
    <div class="experiment-card__header">
      <span class="experiment-card__id">${exp.id}</span>
      <span class="experiment-card__outcome ${outcomeClass}">${outcomeText}</span>
    </div>
    <p class="experiment-card__description">${escapeHtml(description)}</p>
    ${predictionHtml}
    ${rangeHtml}
    <div class="experiment-card__metric">
      <span class="experiment-card__metric-value">${metricDisplay}</span>
    </div>
    ${exp.outcomeVsPrediction ? `<div class="experiment-card__prediction" style="font-style: italic;">${escapeHtml(truncate(exp.outcomeVsPrediction, 150))}</div>` : ""}
    ${commitDisplay ? `<div class="experiment-card__commit">sha: ${commitDisplay}</div>` : ""}
  `;
  
  return card;
}

function renderPredictionRange(exp: Experiment, _actualValue: number): string {
  // Very simplified - just show a visual indicator
  const matched = exp.hypothesis?.outcome?.matched || exp.hypothesis?.outcome?.partiallyMatched;
  const actualClass = matched ? "prediction-range__actual--matched" : "prediction-range__actual--violated";
  
  return `
    <div class="prediction-range">
      <div class="prediction-range__bar" style="left: 10%; right: 10%;"></div>
      <div class="prediction-range__predicted" style="left: 20%; right: 30%;"></div>
      <div class="prediction-range__actual ${actualClass}" style="left: 50%;"></div>
    </div>
  `;
}

function getOutcomeText(outcome: string, reason?: string): string {
  switch (outcome) {
    case "kept": return "kept";
    case "discarded": return reason === "regression" ? "regression" : "discarded";
    case "crashed": return "crashed";
    case "below_noise": return "below noise";
    case "running": return "running";
    default: return outcome;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen - 3) + "..." : text;
}
