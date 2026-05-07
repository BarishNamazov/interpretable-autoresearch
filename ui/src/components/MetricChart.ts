import { activeRun, store } from "../state/store.ts";
import { clear, h, svg } from "./dom.ts";
import type { UIMetricPoint } from "../data/projection.ts";

const PAD = { top: 14, right: 18, bottom: 24, left: 44 };

export function renderMetricChart(host: HTMLElement): void {
  let tooltip: HTMLDivElement | null = null;

  const draw = () => {
    clear(host);
    host.classList.add("metric-section");
    const ar = activeRun();
    host.appendChild(h("h2", {}, ["Primary metric"]));

    if (!ar || ar.run.metric.length === 0) {
      host.appendChild(h("div", { class: "empty-state" }, ["no measurements yet"]));
      return;
    }
    const points = ar.run.metric;
    const direction = ar.run.metricDirection;
    const metricKey = ar.run.metricKey;
    const baseline = ar.run.baseline;
    const best = ar.run.best;

    host.appendChild(
      h("div", { class: "metric-meta" }, [
        h("span", {}, [
          "metric ",
          h("b", {}, [metricKey, " (", direction === "lower_better" ? "lower better" : "higher better", ")"]),
        ]),
        baseline !== undefined
          ? h("span", {}, ["baseline ", h("b", {}, [baseline.toFixed(4)])])
          : null,
        best !== undefined
          ? h("span", {}, ["best ", h("b", {}, [best.toFixed(4)])])
          : null,
      ].filter(Boolean) as Node[])
    );

    const container = h("div", { class: "metric-chart-container" });
    host.appendChild(container);

    const rect = container.getBoundingClientRect();
    const width = Math.max(rect.width || host.clientWidth || 480, 200);
    const height = Math.max(rect.height || 160, 120);
    const sel = store.get().selectedEventId;
    const root = svg("svg", { viewBox: `0 0 ${width} ${height}` });
    container.appendChild(root);

    const xs = points.map((p) => p.experimentIndex);
    const ys = points.map((p) => p.value);
    const xMin = Math.min(...xs, 0);
    const xMax = Math.max(...xs, xs.length);
    const yMin = Math.min(...ys);
    const yMax = Math.max(...ys);
    const yPad = (yMax - yMin) * 0.12 || Math.max(1e-6, Math.abs(yMin) * 0.05);
    const yLow = yMin - yPad;
    const yHigh = yMax + yPad;

    const xScale = (x: number) =>
      PAD.left + ((x - xMin) / Math.max(1, xMax - xMin)) * (width - PAD.left - PAD.right);
    const yScale = (y: number) =>
      PAD.top + (1 - (y - yLow) / Math.max(1e-9, yHigh - yLow)) * (height - PAD.top - PAD.bottom);

    // Axes
    const axes = svg("g", { class: "metric-axis" });
    root.appendChild(axes);
    // y ticks (5 evenly)
    for (let i = 0; i <= 4; i++) {
      const t = yLow + (i / 4) * (yHigh - yLow);
      const yy = yScale(t);
      axes.appendChild(svg("line", { x1: PAD.left, x2: width - PAD.right, y1: yy, y2: yy }));
      axes.appendChild(
        svg("text", { x: 4, y: yy + 4, "text-anchor": "start" }, [t.toFixed(3)])
      );
    }
    // x label
    axes.appendChild(
      svg(
        "text",
        { x: width / 2, y: height - 4, "text-anchor": "middle" },
        ["experiment order"]
      )
    );

    // Best-so-far line
    const linePts = points.map((p) => `${xScale(p.experimentIndex)},${yScale(p.bestSoFar)}`).join(" ");
    root.appendChild(svg("polyline", { class: "metric-line", points: linePts }));

    // Dots
    for (const p of points) {
      const cx = xScale(p.experimentIndex);
      const cy = yScale(p.value);
      const cls = `metric-dot ${p.outcome}` + (p.measureEventId === sel ? " selected" : "");
      const dot = svg("circle", { cx, cy, r: 5, class: cls, "data-event-id": p.measureEventId });
      dot.addEventListener("click", () => store.set({ selectedEventId: p.measureEventId }));
      dot.addEventListener("mouseenter", (e: Event) => {
        const me = e as MouseEvent;
        showTooltip(container, me, p);
      });
      dot.addEventListener("mouseleave", () => hideTooltip());
      root.appendChild(dot);
    }
  };

  function showTooltip(parent: HTMLElement, e: MouseEvent, p: UIMetricPoint) {
    if (!tooltip) {
      tooltip = h("div", { class: "metric-tooltip" }) as HTMLDivElement;
      parent.appendChild(tooltip);
    }
    const lines = [
      `${p.experimentId} · ${p.outcome}`,
      `value ${p.value.toFixed(4)} · best ${p.bestSoFar.toFixed(4)}`,
    ];
    if (p.hypothesisDescription)
      lines.push(`H: ${p.hypothesisDescription.length > 60 ? p.hypothesisDescription.slice(0, 60) + "…" : p.hypothesisDescription}`);
    tooltip.textContent = lines.join("\n");
    tooltip.style.whiteSpace = "pre";
    const rect = parent.getBoundingClientRect();
    tooltip.style.left = `${e.clientX - rect.left + 12}px`;
    tooltip.style.top = `${e.clientY - rect.top + 12}px`;
  }
  function hideTooltip() {
    if (tooltip) {
      tooltip.remove();
      tooltip = null;
    }
  }

  store.subscribe(draw);
  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("resize", () => raf(draw));
  }
  // Initial draw deferred so the container has a measured size.
  raf(draw);
}

function raf(cb: () => void): void {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(cb);
  else setTimeout(cb, 16);
}
