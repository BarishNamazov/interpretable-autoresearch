// Domain types
export type Domain = "model-training" | "performance-engineering";

export type MetricDirection = "lower_better" | "higher_better";

export type OutcomeStatus = "kept" | "discarded" | "crashed" | "running" | "below_noise";

export type Concept = 
  | "Hypothesizing" 
  | "Modifying" 
  | "Experimenting" 
  | "Evaluating" 
  | "Logging" 
  | "Communicating" 
  | "Requesting"
  | "Profiling"
  | "Discovering"
  | "Committing";

// Raw event as parsed from JSONL
export interface RawEvent {
  event_id: string;
  ts: string;
  by: string;
  action: string;
  args: Record<string, unknown>;
  caused_by: string[];
}

// Processed event node with derived metadata
export interface EventNode {
  id: string;
  ts: Date;
  action: string;
  concept: Concept;
  verb: string;
  args: Record<string, unknown>;
  causedBy: string[];
  children: string[];
  experimentId?: string;
  hypothesisId?: string;
  profileId?: string;
  raw: RawEvent;
}

// Hypothesis with prediction structure
export interface Prediction {
  direction: string;
  magnitude: string;
  mechanism: string;
  side_effects?: string;
}

export interface Hypothesis {
  id: string;
  description: string;
  reasoning: string;
  prediction: Prediction;
  informedByExperiment?: string;
  informedByProfile?: string;
  experimentId?: string;
  eventId: string;
  outcome?: {
    matched: boolean;
    partiallyMatched?: boolean;
    violated?: boolean;
    belowNoise?: boolean;
    outcomeText?: string;
  };
}

// Code modification
export interface Modification {
  changeId: string;
  files: string[];
  fromHypothesis: string;
  summary: string;
  diffBrief: string;
  eventId: string;
  reverted?: boolean;
}

// Metric measurement
export interface Measurement {
  experimentId: string;
  primary: { key: string; value: number };
  secondary?: Array<{ key: string; value: number | string }>;
  status: "ok" | "crashed" | "tests_failed";
  significance?: "above_noise" | "below_noise";
  crashExcerpt?: string;
  eventId: string;
}

// Experiment lifecycle
export interface Experiment {
  id: string;
  hypothesisId?: string;
  hypothesis?: Hypothesis;
  changeId?: string;
  modification?: Modification;
  commitSha?: string;
  measurement?: Measurement;
  outcome: OutcomeStatus;
  outcomeReason?: string;
  outcomeVsPrediction?: string;
  description?: string;
  startedAt?: Date;
  finishedAt?: Date;
  eventIds: string[];
}

// Metric time series point
export interface MetricPoint {
  experimentId: string;
  experimentIndex: number;
  value: number;
  bestSoFar: number;
  outcome: OutcomeStatus;
  hypothesis?: string;
  delta?: number;
  deltaPercent?: number;
}

// Profile data (perf-eng only)
export interface HotAttribution {
  function: string;
  percent_of_total: number | string;
}

export interface Profile {
  id: string;
  tool: string;
  target: string;
  hotAttribution: HotAttribution[];
  staleAfter?: string;
  notes?: string;
  eventId: string;
  informedHypotheses: string[];
}

// Discovery data
export interface ModuleSummary {
  path: string;
  summary: string;
}

export interface NoiseFloor {
  primaryMetricValueRuns: number[];
  spreadPct: number;
}

export interface Benchmark {
  origin: "found" | "wrote";
  path: string;
  command?: string;
  primaryMetric: { key: string; direction: MetricDirection };
  secondaryMetrics: string[];
  noiseFloor: NoiseFloor;
}

export interface HotPathHypothesis {
  description: string;
  reasoning: string;
}

export interface Discovery {
  codebaseMap: { moduleSummaries: ModuleSummary[] };
  hotPathHypothesis: HotPathHypothesis;
  benchmark: Benchmark;
  openQuestions: string[];
  eventId: string;
}

// Communication messages
export interface Communication {
  id: string;
  direction: "surfaced" | "received";
  from?: string;
  topic?: string;
  message: string;
  refersTo: string[];
  inResponseTo?: string;
  eventId: string;
  ts: Date;
}

// Full run DSL - the contract between interpreters and components
export interface Run {
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
  
  // Domain-specific optional fields
  discovery?: Discovery;
  profiles?: Profile[];
  
  // Derived stats
  stats: {
    totalExperiments: number;
    keptExperiments: number;
    discardedExperiments: number;
    crashedExperiments: number;
    currentBest: number;
    baselineValue: number;
    improvementPercent: number;
    totalEvents: number;
  };
}

// API response types
export interface DomainData {
  events: string;
  program: string;
}

// Keyed by domain id (e.g. "model-training"). The dict shape lets the
// server add new domains without UI changes.
export type ApiResponse = Record<string, DomainData>;
