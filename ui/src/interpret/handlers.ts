import type { Domain } from "../types.ts";

export type PanelType = 
  | "discovery" 
  | "stats" 
  | "metricChart" 
  | "provenance" 
  | "experiments" 
  | "hypotheses" 
  | "profiling" 
  | "communications" 
  | "eventStream";

export interface DomainHandler {
  label: string;
  metricLabel: string;
  metricKey: string;
  metricDirection: "lower_better" | "higher_better";
  formatMetric: (v: number) => string;
  panels: PanelType[];
  accentKept: string;
  accentDiscarded: string;
  accentCrash: string;
  accentBelowNoise: string;
}

export const domainHandlers: Record<Domain, DomainHandler> = {
  "model-training": {
    label: "Model Training",
    metricLabel: "val_bpb",
    metricKey: "val_bpb",
    metricDirection: "lower_better",
    formatMetric: (v) => v.toFixed(6),
    panels: ["discovery", "stats", "metricChart", "provenance", "experiments", "hypotheses", "communications", "eventStream"],
    accentKept: "#d94f2b",
    accentDiscarded: "#6b8ca8",
    accentCrash: "#d4a017",
    accentBelowNoise: "#8b8b8b",
  },
  "performance-engineering": {
    label: "Performance Engineering",
    metricLabel: "median seconds",
    metricKey: "primary_median_seconds",
    metricDirection: "lower_better",
    formatMetric: (v) => v.toFixed(4) + "s",
    panels: ["discovery", "stats", "metricChart", "provenance", "experiments", "hypotheses", "profiling", "communications", "eventStream"],
    accentKept: "#d94f2b",
    accentDiscarded: "#6b8ca8",
    accentCrash: "#d4a017",
    accentBelowNoise: "#8b8b8b",
  }
};

export function getHandler(domain: Domain): DomainHandler {
  return domainHandlers[domain];
}
