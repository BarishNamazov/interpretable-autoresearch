# `ui/` — Interpretable AutoResearch Observatory

A focused three-pane visualisation app over `events.jsonl`.

```
┌──────────────────────────┬────────────────────────────────────┐
│  Run header + metric     │                                    │
│  chart  (top-left)       │   Inspector / Hypotheses /         │
│                          │   Insights tabs (right)            │
├──────────────────────────┤                                    │
│  Event stream (bottom-   │                                    │
│  left), filterable,      │                                    │
│  freestyle-highlighted   │                                    │
└──────────────────────────┴────────────────────────────────────┘
```

The UI is **concept-driven**: it reads `program.md` and renders panels based on the concepts that exist there, with no per-domain code paths. Adding a third domain requires zero UI change.

## Run

```bash
bun install
bun run dev      # http://localhost:3000  (live, reads ../<domain>/events.jsonl)
bun run build    # static bundle in ./dist (used for the live URL)
bun run typecheck
bun test
```

`server.ts` exposes `/api/runs` (and `/runs.json`) returning `{ [domain]: { events, program } }`. The static build emits `runs.json` next to `index.html`, so the same UI works on a static deploy (e.g. Cloudflare Pages).

## Architecture

```
src/
├── data/
│   ├── api.ts          fetch /api/runs (live) or runs.json (static)
│   ├── parse.ts        strict events.jsonl parser
│   ├── program.ts      program.md → { concepts, reactions, actionToReaction }
│   ├── projection.ts   events → { events, hypotheses, experiments, metric, freestyles, … }
│   └── insights.ts     auto-derived stats (hit rate, themes, noise-floor mismatches)
├── state/
│   └── store.ts        tiny pub/sub: { runId, selectedEventId, tab, filters }
├── components/
│   ├── App.ts
│   ├── RunHeader.ts
│   ├── MetricChart.ts          SVG-only, no chart libs; click a dot → selectedEventId
│   ├── EventStream.ts          virtualised list w/ concept colour pills + freestyle badge
│   ├── inspector/Inspector.ts  event JSON, reaction trace, causal chain, prediction-vs-outcome
│   ├── HypothesesTab.ts        cards: prediction (4 fields) ↔ outcome ↔ status pill
│   ├── InsightsTab.ts          stats + theme buckets + hook-warning surfacing
│   └── dom.ts                  ~30-line element/svg helper, no framework
└── styles/tokens.css           concept colours + density tokens (one stylesheet)
```

## Design principles

- **One thing per page.** Metric chart + event stream are co-visible because they share a time axis. Everything else is an inspector tab.
- **Click anywhere, see provenance everywhere.** Clicking a dot on the chart, an event in the stream, or a hypothesis card all set the same `selectedEventId` and update the inspector.
- **Concepts are first-class.** Stable colour per concept. `Freestyling` events get a distinct red border so off-script work is visible at a glance.
- **Nothing fabricated.** The renderer never synthesises a "discovery" or "profiling" panel that the underlying program.md does not declare.

## Tests

- `src/tests/projection.test.ts` — golden snapshot of the projection over both committed `events.jsonl` files + status-classification tests.
- `src/tests/smoke.test.ts` — happy-dom render of the bundle against the fixture; clicks the first event and asserts the inspector shows a Causal chain.
