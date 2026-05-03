import type { Run, Profile } from "../types.ts";

export function renderProfilingPanel(host: HTMLElement, run: Run): void {
  const panel = document.createElement("section");
  panel.className = "panel profiling-panel";
  
  const profiles = run.profiles || [];
  
  if (profiles.length === 0) {
    panel.innerHTML = `
      <div class="panel__header">
        <h2 class="panel__title">Profiling</h2>
      </div>
      <div class="loading">No profiles taken</div>
    `;
    host.appendChild(panel);
    return;
  }
  
  panel.innerHTML = `
    <div class="panel__header">
      <h2 class="panel__title">Profiling</h2>
      <span class="panel__badge">${profiles.length} profiles</span>
    </div>
    <div class="profiling-panel__content"></div>
  `;
  
  const content = panel.querySelector(".profiling-panel__content") as HTMLElement;
  
  for (const profile of profiles) {
    const card = renderProfileCard(profile);
    content.appendChild(card);
  }
  
  host.appendChild(panel);
}

function renderProfileCard(profile: Profile): HTMLElement {
  const card = document.createElement("div");
  card.className = "profile-card";
  
  // Build hot attribution bars
  const bars = profile.hotAttribution
    .filter(attr => {
      const pct = typeof attr.percent_of_total === "number" 
        ? attr.percent_of_total 
        : parseFloat(String(attr.percent_of_total));
      return !isNaN(pct) && pct > 0;
    })
    .slice(0, 5)
    .map(attr => {
      const pct = typeof attr.percent_of_total === "number" 
        ? attr.percent_of_total 
        : parseFloat(String(attr.percent_of_total));
      const width = Math.min(pct, 100);
      const funcName = truncate(attr.function, 60);
      
      return `
        <div class="profile-card__bar-container">
          <div class="profile-card__bar-label">
            <span>${escapeHtml(funcName)}</span>
            <span>${pct.toFixed(1)}%</span>
          </div>
          <div class="profile-card__bar">
            <div class="profile-card__bar-fill" style="width: ${width}%;"></div>
          </div>
        </div>
      `;
    }).join("");
  
  // Informed hypotheses
  const informedText = profile.informedHypotheses.length > 0
    ? `Informed: ${profile.informedHypotheses.join(", ")}`
    : "";
  
  card.innerHTML = `
    <div class="profile-card__header">
      <span class="profile-card__id">${profile.id}</span>
      <span class="profile-card__tool">${profile.tool} · ${profile.target}</span>
    </div>
    ${bars}
    ${profile.notes ? `<div class="profile-card__notes">${escapeHtml(profile.notes)}</div>` : ""}
    ${informedText ? `<div class="profile-card__informed">${informedText}</div>` : ""}
    ${profile.staleAfter ? `<div class="profile-card__informed">Stale after: ${profile.staleAfter}</div>` : ""}
  `;
  
  return card;
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
