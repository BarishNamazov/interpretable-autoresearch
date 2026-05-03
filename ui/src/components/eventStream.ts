import type { Run, EventNode, Concept } from "../types.ts";

const ALL_CONCEPTS: Concept[] = [
  "Hypothesizing", "Modifying", "Experimenting", "Evaluating", 
  "Logging", "Communicating", "Requesting", "Profiling", "Discovering", "Committing"
];

export function renderEventStream(host: HTMLElement, run: Run): void {
  const panel = document.createElement("section");
  panel.className = "panel event-stream";
  
  const { events } = run;
  
  panel.innerHTML = `
    <div class="panel__header">
      <h2 class="panel__title">Event Stream</h2>
      <span class="panel__badge">${events.length} events</span>
    </div>
    <div class="event-stream__controls"></div>
    <div class="event-stream__list"></div>
  `;
  
  const controls = panel.querySelector(".event-stream__controls") as HTMLElement;
  const list = panel.querySelector(".event-stream__list") as HTMLElement;
  
  // State
  let activeFilters = new Set<Concept>();
  
  // Add "All" button
  const allBtn = document.createElement("button");
  allBtn.className = "event-stream__filter event-stream__filter--active";
  allBtn.textContent = "All";
  allBtn.addEventListener("click", () => {
    activeFilters.clear();
    updateFilters();
    renderEvents();
  });
  controls.appendChild(allBtn);
  
  // Add filter buttons for each concept
  for (const concept of ALL_CONCEPTS) {
    const count = events.filter(e => e.concept === concept).length;
    if (count === 0) continue;
    
    const btn = document.createElement("button");
    btn.className = "event-stream__filter";
    btn.textContent = `${concept} (${count})`;
    btn.dataset.concept = concept;
    
    btn.addEventListener("click", () => {
      if (activeFilters.has(concept)) {
        activeFilters.delete(concept);
      } else {
        activeFilters.add(concept);
      }
      updateFilters();
      renderEvents();
    });
    
    controls.appendChild(btn);
  }
  
  function updateFilters() {
    const buttons = controls.querySelectorAll(".event-stream__filter");
    buttons.forEach(btn => {
      const concept = (btn as HTMLElement).dataset.concept as Concept | undefined;
      if (!concept) {
        // "All" button
        btn.classList.toggle("event-stream__filter--active", activeFilters.size === 0);
      } else {
        btn.classList.toggle("event-stream__filter--active", activeFilters.has(concept));
      }
    });
  }
  
  function renderEvents() {
    list.innerHTML = "";
    
    const filtered = activeFilters.size === 0 
      ? events 
      : events.filter(e => activeFilters.has(e.concept));
    
    for (const evt of filtered) {
      const row = renderEventRow(evt);
      list.appendChild(row);
    }
  }
  
  renderEvents();
  host.appendChild(panel);
}

function renderEventRow(evt: EventNode): HTMLElement {
  const row = document.createElement("div");
  row.className = "event-row";
  row.dataset.eventId = evt.id;
  
  // Get summary from args
  let summary = "";
  const args = evt.args;
  if (args.experiment_id) summary = args.experiment_id as string;
  else if (args.hypothesis_id) summary = args.hypothesis_id as string;
  else if (args.description) summary = (args.description as string).slice(0, 50);
  else if (args.message) summary = (args.message as string).slice(0, 50);
  else if (args.topic) summary = args.topic as string;
  
  row.innerHTML = `
    <span class="event-row__id">${evt.id}</span>
    <span class="event-row__action event-row__action--${evt.concept}">${evt.action}</span>
    <span class="event-row__summary">${escapeHtml(summary)}</span>
  `;
  
  row.addEventListener("click", () => {
    // Highlight this event in the provenance timeline
    const provenanceEvent = document.querySelector(`[data-id="${evt.id}"]`);
    if (provenanceEvent) {
      provenanceEvent.scrollIntoView({ behavior: "smooth", block: "center" });
      
      // Add highlight effect
      document.querySelectorAll(".event-row--highlighted").forEach(el => {
        el.classList.remove("event-row--highlighted");
      });
      row.classList.add("event-row--highlighted");
    }
  });
  
  return row;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
