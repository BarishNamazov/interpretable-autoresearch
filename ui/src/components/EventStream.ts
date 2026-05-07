import { activeRun, store } from "../state/store.ts";
import { clear, h } from "./dom.ts";
import type { UIEvent } from "../data/projection.ts";

function summarize(ev: UIEvent): string {
  const a = ev.args;
  const eid = (a.experiment_id as string) ?? "";
  const verb = ev.verb;
  if (ev.action === "Hypothesizing.formed")
    return `${verb} — ${trim((a.description as string) ?? "")}`;
  if (ev.action === "Modifying.applied")
    return `${verb} ${(a.to as string) ?? (Array.isArray(a.files) ? (a.files as string[]).join(", ") : "")}`;
  if (ev.action === "Experimenting.proposed" || ev.action === "Experimenting.run")
    return `${verb} ${eid}`;
  if (ev.action === "Evaluating.measured") {
    const status = (a.status as string) ?? "";
    const v = (a.primary as { value?: number } | undefined)?.value ?? (a.value as number | undefined);
    return `${verb} ${eid} ${status}${typeof v === "number" ? ` (${v.toFixed(4)})` : ""}`;
  }
  if (ev.action === "Experimenting.kept" || ev.action === "Experimenting.discarded")
    return `${verb} ${eid}`;
  if (ev.action === "Logging.recorded")
    return `${verb} ${eid} — ${trim((a.outcome_vs_prediction as string) ?? "")}`;
  if (ev.action === "Communicating.surfaced")
    return `surface ${trim((a.message as string) ?? (a.topic as string) ?? "")}`;
  if (ev.action === "Communicating.received")
    return `received ${trim((a.message as string) ?? "")}`;
  if (ev.action === "Profiling.profiled")
    return `profiled ${(a.target as string) ?? ""}`;
  if (ev.action === "Discovering.completed")
    return `discovered codebase + noise floor`;
  if (ev.action === "Requesting.requested")
    return `request → ${(a.request as string) ?? ""}`;
  return `${verb} ${trim(JSON.stringify(a))}`;
}

function trim(s: string, n = 80): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export function renderEventStream(host: HTMLElement): void {
  let scrollTop = 0;

  const render = () => {
    const ar = activeRun();
    const s = store.get();
    if (host.children.length === 0) {
      const toolbar = h("div", { class: "toolbar" }, [
        h("input", {
          type: "search",
          placeholder: "filter… e.g. Hypothesizing or 'lr'",
          value: s.query,
          on: {
            input: (e: Event) => store.set({ query: (e.target as HTMLInputElement).value }),
          },
        }),
        h(
          "select",
          {
            on: {
              change: (e: Event) => store.set({ conceptFilter: (e.target as HTMLSelectElement).value }),
            },
          },
          [
            h("option", { value: "all", selected: s.conceptFilter === "all" }, ["all concepts"]),
            ...(ar
              ? Object.keys(ar.run.conceptCounts)
                  .sort()
                  .map((c) =>
                    h(
                      "option",
                      { value: c, selected: s.conceptFilter === c },
                      [`${c} (${ar.run.conceptCounts[c]})`]
                    )
                  )
              : []),
          ]
        ),
        h("label", { style: "display:flex; gap:4px; align-items:center; color:var(--text-muted); font-size:12px;" }, [
          h("input", {
            type: "checkbox",
            checked: s.showFreestyleOnly,
            on: {
              change: (e: Event) => store.set({ showFreestyleOnly: (e.target as HTMLInputElement).checked }),
            },
          }),
          "freestyle only",
        ]),
      ]);
      host.classList.add("event-stream");
      host.appendChild(toolbar);
      host.appendChild(h("ul", { class: "stream-list" }));
    }

    const list = host.querySelector(".stream-list") as HTMLUListElement;
    scrollTop = list.scrollTop;
    clear(list);
    if (!ar) {
      list.appendChild(h("li", { class: "empty-state" }, ["no events"]));
      return;
    }

    const q = s.query.toLowerCase();
    const filtered = ar.run.events.filter((e) => {
      if (s.conceptFilter !== "all" && e.concept !== s.conceptFilter) return false;
      if (s.showFreestyleOnly && !e.isFreestyle) return false;
      if (q) {
        const hay = `${e.action} ${e.id} ${JSON.stringify(e.args)}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    for (const ev of filtered) {
      const concept = ev.concept;
      const colour = `var(--c-${concept}, var(--text-muted))`;
      const li = h(
        "li",
        {
          class: `event-row${ev.id === s.selectedEventId ? " selected" : ""}${ev.isFreestyle ? " freestyle" : ""}`,
          on: {
            click: () => store.set({ selectedEventId: ev.id }),
          },
        },
        [
          h("span", { class: "id" }, [ev.id.replace(/^evt-0+/, "")]),
          h("span", { class: "pill", style: `--c: ${colour}` }, [concept]),
          h("span", { class: "summary" }, [
            ev.isFreestyle ? h("span", { class: "badge-fs" }, ["FS"]) : null,
            h("span", { class: "verb" }, [ev.verb]),
            summarize(ev),
          ].filter(Boolean) as Node[]),
        ]
      );
      list.appendChild(li);
    }
    if (filtered.length === 0) {
      list.appendChild(h("li", { class: "empty-state", style: "padding: 24px" }, ["no events match filters"]));
    }

    // Restore scroll, or scroll selected into view if it changed.
    if (s.selectedEventId) {
      const sel = list.querySelector(".event-row.selected") as HTMLElement | null;
      if (sel) {
        const r = sel.getBoundingClientRect();
        const lr = list.getBoundingClientRect();
        if (r.top < lr.top || r.bottom > lr.bottom) sel.scrollIntoView({ block: "nearest" });
      }
    } else {
      list.scrollTop = scrollTop;
    }
  };

  store.subscribe(render);
  render();
}
