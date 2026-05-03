# Interpretable AutoResearch — Observatory UI

A beautiful, single-page visualization for AutoResearch event logs. Built with Bun, TypeScript, and hand-crafted SVG visualizations.

## Quick Start

```bash
cd ui
bun install
bun run dev
# Open http://localhost:3000
```

## Architecture

The UI follows a strict **DSL + Interpreter + Handler** pattern that cleanly separates data processing from presentation:

```
┌─────────────────────────────────────────────────────────────────┐
│  Raw JSONL Events  →  Interpreter  →  DSL (Run)  →  Components │
└─────────────────────────────────────────────────────────────────┘
```

### Core Files

```
ui/
├── server.ts              # Bun.serve entry — serves HTML and /api/runs
├── index.html             # Main HTML with Google Fonts
├── src/
│   ├── main.ts            # Client entrypoint
│   ├── types.ts           # DSL types (Run, Experiment, Hypothesis, etc.)
│   ├── parse.ts           # JSONL → RawEvent[]
│   ├── interpret/
│   │   ├── index.ts       # Domain router
│   │   ├── shared.ts      # Common rollup logic (experiments, hypotheses, metrics)
│   │   ├── modelTraining.ts       # model-training interpreter
│   │   ├── performanceEngineering.ts  # performance-engineering interpreter
│   │   └── handlers.ts    # Per-domain configuration (panels, formatting)
│   ├── components/
│   │   ├── app.ts         # Main app orchestrator
│   │   ├── header.ts
│   │   ├── stats.ts       # Stat tiles row
│   │   ├── metricChart.ts # SVG metric trajectory
│   │   ├── provenanceTimeline.ts  # SVG provenance/reaction chain
│   │   ├── experimentList.ts      # Experiment cards
│   │   ├── hypothesisGrid.ts      # Hypothesis outcome heatmap
│   │   ├── profilingPanel.ts      # Hot attribution bars
│   │   ├── discoveryPanel.ts      # Codebase map, noise floor
│   │   ├── communications.ts      # Agent ↔ user transcript
│   │   ├── eventStream.ts         # Filterable raw event tape
│   │   └── domainSwitcher.ts
│   └── styles.css         # Mission control aesthetic
```

### The DSL

The `Run` interface is the contract between interpreters and components:

```typescript
interface Run {
  domain: Domain;
  agentId: string;
  startedAt: Date;
  events: EventNode[];
  eventsById: Map<string, EventNode>;
  experiments: Experiment[];
  hypotheses: Hypothesis[];
  metricSeries: MetricPoint[];
  communications: Communication[];
  modifications: Modification[];
  
  // Domain-specific (optional)
  discovery?: Discovery;  // perf-eng only
  profiles?: Profile[];   // perf-eng only
  
  stats: { ... };
}
```

Components **only** consume the DSL — they never touch raw events directly.

### Domain Handlers

Each domain declares its configuration in `handlers.ts`:

```typescript
export const domainHandlers: Record<Domain, DomainHandler> = {
  "model-training": {
    label: "Model Training",
    metricLabel: "val_bpb",
    metricDirection: "lower_better",
    formatMetric: (v) => v.toFixed(6),
    panels: ["stats", "metricChart", "provenance", "experiments", ...],
    ...
  },
  "performance-engineering": {
    label: "Performance Engineering",
    panels: ["discovery", "stats", "metricChart", "profiling", ...],
    ...
  }
};
```

## Adding a New Domain

1. **Create an interpreter** in `src/interpret/<domain>.ts`:
   - Parse domain-specific event fields
   - Use shared rollup functions from `shared.ts`
   - Return a `Run` object

2. **Register the interpreter** in `src/interpret/index.ts`

3. **Add a handler entry** in `src/interpret/handlers.ts`:
   - Configure which panels to show
   - Set metric formatting
   - Define accent colors

4. **Update the server** in `server.ts` to load the new domain's data

## Design System

The "research observatory / mission control" aesthetic uses:

- **Dark canvas**: `#0b0d10` with subtle noise texture
- **Cream paper panels**: `#f4ede0` for content cards
- **Accent palette**:
  - Vermilion (`#d94f2b`) for kept/improvement
  - Steel blue (`#6b8ca8`) for discarded
  - Amber (`#d4a017`) for crashes
- **Typography**: Fraunces (serif display) + JetBrains Mono (data/code)

## Scripts

```bash
bun run dev        # Start dev server with hot reload
bun run start      # Start production server
bun run typecheck  # Type-check without emitting
bun run build      # Bundle client for production
```

## API Endpoints

- `GET /` — Serves the main HTML
- `GET /api/runs` — Returns both domains' events.jsonl and program.md
- `GET /api/runs/:domain` — Returns a single domain's data

## Visualizations

### Metric Chart
SVG line chart showing primary metric over experiments. Features:
- Color-coded points by outcome (kept/discarded/crashed)
- Best-so-far envelope line
- Noise floor band (perf-eng)
- Animated line draw on load
- Hover tooltips with prediction info

### Provenance Timeline
SVG visualization of the reaction chain. Features:
- Glyphs for each concept (diamond=Hypothesizing, etc.)
- Curved causal links between events
- Swimlanes grouping events by experiment
- Minimap with viewport indicator

### Experiment Cards
Detailed cards for each experiment showing:
- Hypothesis description
- Prediction vs actual metric
- Outcome verdict
- Commit SHA

### Profiling Panel
Hot attribution bars showing function-level cost distribution, linked to informed hypotheses.

### Discovery Panel
Codebase map, benchmark info, noise floor visualization, and open questions.
