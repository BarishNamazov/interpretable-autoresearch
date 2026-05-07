// Tiny pub/sub store. No frameworks.
import type { UIProgram } from "../data/program.ts";
import type { UIRunProjection } from "../data/projection.ts";

export type Tab = "inspector" | "hypotheses" | "insights";
export type ConceptFilter = "all" | string;

export interface AppState {
  runId: string | null;
  runs: Record<string, { run: UIRunProjection; program: UIProgram } | undefined>;
  selectedEventId: string | null;
  tab: Tab;
  conceptFilter: ConceptFilter;
  showFreestyleOnly: boolean;
  query: string;
  loading: boolean;
  error: string | null;
}

type Listener = (state: AppState) => void;

class Store {
  private state: AppState = {
    runId: null,
    runs: {},
    selectedEventId: null,
    tab: "inspector",
    conceptFilter: "all",
    showFreestyleOnly: false,
    query: "",
    loading: true,
    error: null,
  };
  private listeners = new Set<Listener>();

  get(): AppState {
    return this.state;
  }

  set(partial: Partial<AppState>): void {
    this.state = { ...this.state, ...partial };
    for (const l of this.listeners) l(this.state);
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}

export const store = new Store();

export function activeRun(): { run: UIRunProjection; program: UIProgram } | null {
  const s = store.get();
  if (!s.runId) return null;
  return s.runs[s.runId] ?? null;
}
