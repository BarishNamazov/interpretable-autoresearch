import type { Run, EventNode, Concept } from "../types.ts";

const GLYPH_PATHS: Record<Concept, string> = {
  Hypothesizing: "M0,-6 L5.2,3 L0,0 L-5.2,3 Z", // diamond
  Modifying: "M-5,-5 L5,-5 L5,5 L-5,5 Z", // square
  Experimenting: "M6,0 A6,6 0 1,1 -6,0 A6,6 0 1,1 6,0", // circle
  Evaluating: "M0,-6 L5.2,4 L-5.2,4 Z", // triangle
  Logging: "M-4,-4 L4,-4 L4,4 L-4,4 Z M-6,-1 L-4,-1 M6,-1 L4,-1 M-6,1 L-4,1 M6,1 L4,1", // star-ish
  Communicating: "M-6,3 L-6,-4 L6,-4 L6,3 L0,6 Z", // speech bubble
  Requesting: "M-4,4 L4,-4 M4,-4 L4,0 M4,-4 L0,-4", // arrow
  Profiling: "M0,-5 A5,5 0 1,1 0,5 A5,5 0 1,1 0,-5 M0,-3 L0,3 M-3,0 L3,0", // magnifier
  Discovering: "M0,-6 L2,-2 L6,0 L2,2 L0,6 L-2,2 L-6,0 L-2,-2 Z", // compass
  Committing: "M-4,-4 L0,-1 L4,-4 M0,-1 L0,5"  // git-like
};

const CONCEPT_COLORS: Record<Concept, string> = {
  Hypothesizing: "#7c3aed",
  Modifying: "#0ea5e9",
  Experimenting: "#d94f2b",
  Evaluating: "#10b981",
  Logging: "#6b7280",
  Communicating: "#f59e0b",
  Requesting: "#94a3b8",
  Profiling: "#ec4899",
  Discovering: "#8b5cf6",
  Committing: "#64748b"
};

export function renderProvenanceTimeline(host: HTMLElement, run: Run): void {
  const panel = document.createElement("section");
  panel.className = "panel provenance";
  
  const { events } = run;
  
  if (events.length === 0) {
    panel.innerHTML = `
      <div class="panel__header">
        <h2 class="panel__title">Provenance Timeline</h2>
      </div>
      <div class="loading">No events</div>
    `;
    host.appendChild(panel);
    return;
  }
  
  // Layout config
  const rowHeight = 32;
  const leftGutter = 80;
  const nodeX = 120;
  const labelX = 150;
  const width = 700;
  const height = Math.max(events.length * rowHeight + 40, 400);
  
  // Group events by experiment for swimlanes
  const expBounds = new Map<string, { start: number; end: number }>();
  events.forEach((evt, i) => {
    if (evt.experimentId) {
      const bounds = expBounds.get(evt.experimentId);
      if (!bounds) {
        expBounds.set(evt.experimentId, { start: i, end: i });
      } else {
        bounds.end = i;
      }
    }
  });
  
  // Build swimlanes
  const swimlanes: string[] = [];
  let swimlaneIdx = 0;
  for (const [expId, bounds] of expBounds) {
    const y = bounds.start * rowHeight + 20;
    const h = (bounds.end - bounds.start + 1) * rowHeight;
    swimlanes.push(`<rect class="provenance__swimlane" x="0" y="${y - 5}" width="${width}" height="${h + 10}" rx="4" data-exp="${expId}" />`);
    swimlaneIdx++;
  }
  
  // Build links
  const links: string[] = [];
  const eventIndexMap = new Map<string, number>();
  events.forEach((evt, i) => eventIndexMap.set(evt.id, i));
  
  for (const evt of events) {
    const toIdx = eventIndexMap.get(evt.id);
    if (toIdx === undefined) continue;
    
    const toY = toIdx * rowHeight + 30;
    
    for (const parentId of evt.causedBy) {
      const fromIdx = eventIndexMap.get(parentId);
      if (fromIdx === undefined) continue;
      
      const fromY = fromIdx * rowHeight + 30;
      
      // Curved link
      const midY = (fromY + toY) / 2;
      const curveOffset = Math.min(Math.abs(toIdx - fromIdx) * 5, 30);
      const path = `M ${nodeX} ${fromY} C ${nodeX + curveOffset} ${midY}, ${nodeX + curveOffset} ${midY}, ${nodeX} ${toY}`;
      
      const isCausal = evt.concept === "Experimenting" || evt.concept === "Evaluating";
      links.push(`<path class="provenance__link ${isCausal ? "provenance__link--causal" : ""}" d="${path}" />`);
    }
  }
  
  // Build nodes
  const nodes: string[] = [];
  for (let i = 0; i < events.length; i++) {
    const evt = events[i];
    const y = i * rowHeight + 30;
    const color = CONCEPT_COLORS[evt.concept] || "#6b7280";
    const glyphPath = GLYPH_PATHS[evt.concept] || "M0,-5 A5,5 0 1,1 0,5 A5,5 0 1,1 0,-5";
    
    // Truncate label
    let label = evt.action;
    const argSummary = getArgSummary(evt);
    if (argSummary) {
      label += `: ${argSummary}`;
    }
    if (label.length > 50) label = label.slice(0, 47) + "...";
    
    nodes.push(`
      <g class="provenance__event" data-id="${evt.id}" transform="translate(0, ${y})">
        <text class="provenance__event-id" x="${leftGutter - 5}" y="4" text-anchor="end">${evt.id}</text>
        <g class="provenance__event-glyph" transform="translate(${nodeX}, 0)">
          <path d="${glyphPath}" fill="${color}" />
        </g>
        <text class="provenance__event-label" x="${labelX}" y="4">${escapeHtml(label)}</text>
      </g>
    `);
  }
  
  // Build minimap
  const minimapHeight = 500;
  const minimapScale = minimapHeight / height;
  const minimapNodes: string[] = [];
  for (let i = 0; i < events.length; i++) {
    const evt = events[i];
    const y = i * rowHeight * minimapScale + 15;
    const color = CONCEPT_COLORS[evt.concept] || "#6b7280";
    minimapNodes.push(`<rect x="10" y="${y}" width="60" height="${rowHeight * minimapScale - 1}" fill="${color}" opacity="0.5" rx="2" />`);
  }
  
  panel.innerHTML = `
    <div class="panel__header">
      <h2 class="panel__title">Provenance Timeline</h2>
      <span class="panel__badge">${events.length} events</span>
    </div>
    <div class="provenance__container">
      <div class="provenance__main">
        <svg class="provenance__svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
          ${swimlanes.join("")}
          ${links.join("")}
          ${nodes.join("")}
        </svg>
      </div>
      <div class="provenance__minimap">
        <svg width="80" height="${minimapHeight}">
          ${minimapNodes.join("")}
        </svg>
        <div class="provenance__minimap-viewport" style="top: 0; height: 50%;"></div>
      </div>
    </div>
  `;
  
  host.appendChild(panel);
  
  // Wire up scroll sync
  const mainEl = panel.querySelector(".provenance__main") as HTMLElement;
  const viewport = panel.querySelector(".provenance__minimap-viewport") as HTMLElement;
  
  mainEl.addEventListener("scroll", () => {
    const scrollPct = mainEl.scrollTop / (mainEl.scrollHeight - mainEl.clientHeight);
    const viewportHeight = (mainEl.clientHeight / mainEl.scrollHeight) * minimapHeight;
    viewport.style.height = `${viewportHeight}px`;
    viewport.style.top = `${scrollPct * (minimapHeight - viewportHeight)}px`;
  });
}

function getArgSummary(evt: EventNode): string {
  const args = evt.args;
  if (args.experiment_id) return args.experiment_id as string;
  if (args.hypothesis_id) return args.hypothesis_id as string;
  if (args.change_id) return args.change_id as string;
  if (args.profile_id) return args.profile_id as string;
  if (args.topic) return args.topic as string;
  if (args.message) {
    const msg = args.message as string;
    return msg.length > 30 ? msg.slice(0, 27) + "..." : msg;
  }
  return "";
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
