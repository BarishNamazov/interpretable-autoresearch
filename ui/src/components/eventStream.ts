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
  const wrapper = document.createElement("div");
  wrapper.className = "event-row-wrapper";

  const row = document.createElement("div");
  row.className = "event-row";
  row.dataset.eventId = evt.id;

  const time = evt.ts.toISOString().slice(11, 19);
  const preview = buildPreview(evt.args);

  row.innerHTML = `
    <span class="event-row__toggle">▸</span>
    <span class="event-row__time">${time}</span>
    <span class="event-row__id">${evt.id}</span>
    <span class="event-row__action event-row__action--${evt.concept}">${evt.action}</span>
    <span class="event-row__summary">${preview}</span>
    <button class="event-row__provenance" title="Show in provenance timeline">↗</button>
  `;

  const details = document.createElement("div");
  details.className = "event-row__details";
  details.hidden = true;
  details.innerHTML = renderDetails(evt);

  const toggle = row.querySelector(".event-row__toggle") as HTMLElement;
  row.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).classList.contains("event-row__provenance")) return;
    const open = details.hidden === true;
    details.hidden = !open;
    toggle.textContent = open ? "▾" : "▸";
    row.classList.toggle("event-row--open", open);
  });

  const provBtn = row.querySelector(".event-row__provenance") as HTMLElement;
  provBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const provenanceEvent = document.querySelector(`[data-id="${evt.id}"]`);
    if (provenanceEvent) {
      provenanceEvent.scrollIntoView({ behavior: "smooth", block: "center" });
      document.querySelectorAll(".event-row--highlighted").forEach(el => {
        el.classList.remove("event-row--highlighted");
      });
      row.classList.add("event-row--highlighted");
    }
  });

  wrapper.appendChild(row);
  wrapper.appendChild(details);
  return wrapper;
}

function buildPreview(args: Record<string, unknown>): string {
  const parts: string[] = [];
  const keys = ["experiment_id", "hypothesis_id", "change_id", "profile_id", "request", "from", "topic"];
  for (const k of keys) {
    const v = args[k];
    if (v == null || v === "") continue;
    parts.push(`<span class="event-row__kv"><span class="event-row__k">${k}=</span>${escapeHtml(String(v))}</span>`);
  }
  const text = (args.description ?? args.message ?? args.summary ?? args.note) as string | undefined;
  if (text) {
    const t = String(text).replace(/\s+/g, " ").trim();
    parts.push(`<span class="event-row__text">${escapeHtml(t.slice(0, 120))}${t.length > 120 ? "…" : ""}</span>`);
  }
  return parts.join(" ");
}

function renderDetails(evt: EventNode): string {
  const argsJson = escapeHtml(JSON.stringify(evt.args, null, 2));
  const caused = evt.causedBy.length
    ? evt.causedBy.map(id => `<a class="event-row__cause" data-id="${id}">${id}</a>`).join(", ")
    : "—";
  const children = evt.children.length
    ? evt.children.map(id => `<a class="event-row__cause" data-id="${id}">${id}</a>`).join(", ")
    : "—";
  return `
    <div class="event-row__meta">
      <div><span class="event-row__metalabel">ts</span> ${evt.ts.toISOString()}</div>
      <div><span class="event-row__metalabel">concept</span> ${evt.concept} · ${evt.verb}</div>
      <div><span class="event-row__metalabel">caused_by</span> ${caused}</div>
      <div><span class="event-row__metalabel">children</span> ${children}</div>
    </div>
    <pre class="event-row__args">${argsJson}</pre>
  `;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
