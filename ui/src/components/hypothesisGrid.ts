import type { Run } from "../types.ts";

export function renderHypothesisGrid(host: HTMLElement, run: Run): void {
  const panel = document.createElement("section");
  panel.className = "panel hypothesis-grid";
  
  const { hypotheses } = run;
  
  if (hypotheses.length === 0) {
    panel.innerHTML = `
      <div class="panel__header">
        <h2 class="panel__title">Hypothesis Outcomes</h2>
      </div>
      <div class="loading">No hypotheses formed yet</div>
    `;
    host.appendChild(panel);
    return;
  }
  
  panel.innerHTML = `
    <div class="panel__header">
      <h2 class="panel__title">Hypothesis Outcomes</h2>
      <span class="panel__badge">${hypotheses.length} hypotheses</span>
    </div>
    <table class="hypothesis-grid__table">
      <thead>
        <tr>
          <th class="hypothesis-grid__header">ID</th>
          <th class="hypothesis-grid__header">Description</th>
          <th class="hypothesis-grid__header">Direction</th>
          <th class="hypothesis-grid__header">Magnitude</th>
          <th class="hypothesis-grid__header">Result</th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
  `;
  
  const tbody = panel.querySelector("tbody") as HTMLElement;
  
  for (const hyp of hypotheses) {
    const row = document.createElement("tr");
    row.className = "hypothesis-grid__row";
    
    const outcome = hyp.outcome;
    let badgeClass = "";
    let badgeText = "—";
    
    if (outcome) {
      if (outcome.matched && !outcome.partiallyMatched) {
        badgeClass = "hypothesis-grid__outcome-badge--matched";
        badgeText = "✓";
      } else if (outcome.partiallyMatched) {
        badgeClass = "hypothesis-grid__outcome-badge--partial";
        badgeText = "~";
      } else if (outcome.violated) {
        badgeClass = "hypothesis-grid__outcome-badge--violated";
        badgeText = "✗";
      } else if (outcome.belowNoise) {
        badgeClass = "hypothesis-grid__outcome-badge--below-noise";
        badgeText = "∅";
      }
    }
    
    row.innerHTML = `
      <td class="hypothesis-grid__cell hypothesis-grid__cell--id">${hyp.id}</td>
      <td class="hypothesis-grid__cell">${escapeHtml(truncate(hyp.description, 80))}</td>
      <td class="hypothesis-grid__cell">${escapeHtml(truncate(hyp.prediction.direction, 30))}</td>
      <td class="hypothesis-grid__cell">${escapeHtml(truncate(hyp.prediction.magnitude, 30))}</td>
      <td class="hypothesis-grid__cell hypothesis-grid__cell--outcome">
        <span class="hypothesis-grid__outcome-badge ${badgeClass}">${badgeText}</span>
      </td>
    `;
    
    tbody.appendChild(row);
  }
  
  host.appendChild(panel);
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
