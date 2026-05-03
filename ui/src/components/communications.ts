import type { Run, Communication } from "../types.ts";

export function renderCommunications(host: HTMLElement, run: Run): void {
  const panel = document.createElement("section");
  panel.className = "panel communications";
  
  const { communications } = run;
  
  if (communications.length === 0) {
    panel.innerHTML = `
      <div class="panel__header">
        <h2 class="panel__title">Communications</h2>
      </div>
      <div class="loading">No communications</div>
    `;
    host.appendChild(panel);
    return;
  }
  
  panel.innerHTML = `
    <div class="panel__header">
      <h2 class="panel__title">Communications</h2>
      <span class="panel__badge">${communications.length} messages</span>
    </div>
    <div class="communications__list"></div>
  `;
  
  const list = panel.querySelector(".communications__list") as HTMLElement;
  
  for (const comm of communications) {
    const msg = renderMessage(comm);
    list.appendChild(msg);
  }
  
  host.appendChild(panel);
}

function renderMessage(comm: Communication): HTMLElement {
  const el = document.createElement("div");
  el.className = `comm-message comm-message--${comm.direction}`;
  
  const time = comm.ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const header = comm.direction === "surfaced"
    ? `<span class="comm-message__topic">${escapeHtml(comm.topic || "Agent")}</span><span>${time}</span>`
    : `<span>${comm.from || "User"}</span><span>${time}</span>`;
  
  const refs = comm.refersTo.length > 0
    ? `<div class="comm-message__refs">refs: ${comm.refersTo.join(", ")}</div>`
    : "";
  
  el.innerHTML = `
    <div class="comm-message__header">${header}</div>
    <div class="comm-message__content">${escapeHtml(comm.message)}</div>
    ${refs}
  `;
  
  return el;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
