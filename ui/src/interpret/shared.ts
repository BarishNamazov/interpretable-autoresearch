import type { 
  RawEvent, 
  EventNode, 
  Experiment, 
  Hypothesis, 
  MetricPoint, 
  Communication,
  Modification,
  Concept,
  Prediction,
  Measurement,
  Discovery,
  ModuleSummary
} from "../types.ts";

function parseConcept(action: string): Concept {
  const [concept] = action.split(".");
  return concept as Concept;
}

function parseVerb(action: string): string {
  const parts = action.split(".");
  return parts[1] || "";
}

export function buildEventNodes(rawEvents: RawEvent[]): { events: EventNode[]; eventsById: Map<string, EventNode> } {
  const eventsById = new Map<string, EventNode>();
  const events: EventNode[] = [];
  
  // First pass: create nodes
  for (const raw of rawEvents) {
    const node: EventNode = {
      id: raw.event_id,
      ts: new Date(raw.ts),
      action: raw.action,
      concept: parseConcept(raw.action),
      verb: parseVerb(raw.action),
      args: raw.args,
      causedBy: raw.caused_by,
      children: [],
      raw
    };
    
    // Extract experiment/hypothesis/profile IDs from args
    const args = raw.args as Record<string, unknown>;
    if (args.experiment_id) node.experimentId = args.experiment_id as string;
    if (args.hypothesis_id) node.hypothesisId = args.hypothesis_id as string;
    if (args.profile_id) node.profileId = args.profile_id as string;
    
    events.push(node);
    eventsById.set(node.id, node);
  }
  
  // Second pass: build children links
  for (const node of events) {
    for (const parentId of node.causedBy) {
      const parent = eventsById.get(parentId);
      if (parent) {
        parent.children.push(node.id);
      }
    }
  }
  
  return { events, eventsById };
}

export function buildExperiments(events: EventNode[], _eventsById: Map<string, EventNode>): Experiment[] {
  const experiments: Experiment[] = [];
  const expMap = new Map<string, Partial<Experiment>>();
  
  for (const event of events) {
    const args = event.args;
    const expId = event.experimentId || (args.experiment_id as string | undefined);
    
    if (!expId) continue;
    
    if (!expMap.has(expId)) {
      expMap.set(expId, {
        id: expId,
        eventIds: [],
        outcome: "running"
      });
    }
    
    const exp = expMap.get(expId)!;
    exp.eventIds!.push(event.id);
    
    switch (event.action) {
      case "Experimenting.proposed":
        exp.hypothesisId = args.hypothesis_id as string | undefined;
        exp.changeId = args.change_id as string | undefined;
        exp.description = args.description as string | undefined;
        break;
        
      case "Experimenting.run":
        exp.commitSha = args.commit_sha as string | undefined;
        if (args.started_at) exp.startedAt = new Date(args.started_at as string);
        if (args.finished_at) exp.finishedAt = new Date(args.finished_at as string);
        break;
        
      case "Experimenting.kept":
        exp.outcome = "kept";
        break;
        
      case "Experimenting.discarded":
        const reason = args.reason as string | undefined;
        if (reason === "crash" || reason === "crashed") {
          exp.outcome = "crashed";
        } else if (reason === "below_noise_floor" || reason === "below_noise") {
          exp.outcome = "below_noise";
        } else {
          exp.outcome = "discarded";
        }
        exp.outcomeReason = reason;
        break;
        
      case "Evaluating.measured": {
        const measurement: Measurement = {
          experimentId: expId,
          primary: { key: "", value: 0 },
          status: (args.status as "ok" | "crashed" | "tests_failed") || "ok",
          eventId: event.id
        };
        
        // Handle both model-training and perf-eng schemas
        if (args.primary && typeof args.primary === "object") {
          const primary = args.primary as { key: string; value: number };
          measurement.primary = primary;
        } else if (args.metric && args.value !== undefined) {
          measurement.primary = { 
            key: args.metric as string, 
            value: args.value as number 
          };
        }
        
        if (args.secondary && Array.isArray(args.secondary)) {
          measurement.secondary = args.secondary as Array<{ key: string; value: number | string }>;
        }
        
        if (args.significance) {
          measurement.significance = args.significance as "above_noise" | "below_noise";
        }
        
        if (args.crash_excerpt) {
          measurement.crashExcerpt = args.crash_excerpt as string;
        }
        
        exp.measurement = measurement;
        
        if (args.status === "crashed") {
          exp.outcome = "crashed";
        }
        break;
      }
        
      case "Logging.recorded":
        exp.outcomeVsPrediction = args.outcome_vs_prediction as string | undefined;
        if (!exp.description) {
          exp.description = args.description as string | undefined;
        }
        break;
    }
  }
  
  // Convert map to array and sort by experiment ID
  for (const [, exp] of expMap) {
    experiments.push(exp as Experiment);
  }
  
  experiments.sort((a, b) => {
    const aNum = parseInt(a.id.replace(/\D/g, "")) || 0;
    const bNum = parseInt(b.id.replace(/\D/g, "")) || 0;
    return aNum - bNum;
  });
  
  return experiments;
}

export function buildHypotheses(events: EventNode[]): Hypothesis[] {
  const hypotheses: Hypothesis[] = [];
  
  for (const event of events) {
    if (event.action !== "Hypothesizing.formed") continue;
    
    const args = event.args;
    const prediction = args.prediction as Partial<Prediction> | undefined;
    
    const hypothesis: Hypothesis = {
      id: args.hypothesis_id as string,
      description: args.description as string || "",
      reasoning: args.reasoning as string || "",
      prediction: {
        direction: prediction?.direction || "",
        magnitude: prediction?.magnitude || "",
        mechanism: prediction?.mechanism || "",
        side_effects: prediction?.side_effects
      },
      informedByExperiment: args.informed_by_experiment as string | undefined,
      informedByProfile: args.informed_by_profile as string | undefined,
      eventId: event.id
    };
    
    hypotheses.push(hypothesis);
  }
  
  return hypotheses;
}

export function linkHypothesesToExperiments(
  experiments: Experiment[], 
  hypotheses: Hypothesis[]
): void {
  const hypById = new Map<string, Hypothesis>();
  for (const hyp of hypotheses) {
    hypById.set(hyp.id, hyp);
  }
  
  for (const exp of experiments) {
    if (exp.hypothesisId) {
      const hyp = hypById.get(exp.hypothesisId);
      if (hyp) {
        exp.hypothesis = hyp;
        hyp.experimentId = exp.id;
        
        // Parse outcome from outcomeVsPrediction
        if (exp.outcomeVsPrediction) {
          const text = exp.outcomeVsPrediction.toLowerCase();
          hyp.outcome = {
            matched: text.startsWith("matched"),
            partiallyMatched: text.includes("partially"),
            violated: text.startsWith("violated"),
            belowNoise: text.includes("below-noise") || text.includes("below noise"),
            outcomeText: exp.outcomeVsPrediction
          };
        }
      }
    }
  }
}

export function buildMetricSeries(
  experiments: Experiment[],
  metricDirection: "lower_better" | "higher_better"
): MetricPoint[] {
  const series: MetricPoint[] = [];
  let bestSoFar = metricDirection === "lower_better" ? Infinity : -Infinity;
  
  for (let i = 0; i < experiments.length; i++) {
    const exp = experiments[i];
    if (!exp.measurement?.primary?.value) continue;
    
    const value = exp.measurement.primary.value;
    
    // Update best
    if (metricDirection === "lower_better") {
      if (value < bestSoFar) bestSoFar = value;
    } else {
      if (value > bestSoFar) bestSoFar = value;
    }
    
    const point: MetricPoint = {
      experimentId: exp.id,
      experimentIndex: i,
      value,
      bestSoFar,
      outcome: exp.outcome,
      hypothesis: exp.hypothesis?.description
    };
    
    // Compute delta from previous kept experiment
    const prevKept = [...experiments.slice(0, i)]
      .reverse()
      .find(e => e.outcome === "kept" && e.measurement?.primary?.value);
    
    if (prevKept?.measurement?.primary?.value) {
      const prevValue = prevKept.measurement.primary.value;
      point.delta = value - prevValue;
      point.deltaPercent = ((value - prevValue) / prevValue) * 100;
    }
    
    series.push(point);
  }
  
  return series;
}

export function buildCommunications(events: EventNode[]): Communication[] {
  const comms: Communication[] = [];
  
  for (const event of events) {
    if (event.concept !== "Communicating") continue;
    
    const args = event.args;
    
    const comm: Communication = {
      id: event.id,
      direction: event.verb === "surfaced" ? "surfaced" : "received",
      message: args.message as string || "",
      refersTo: (args.refers_to as string[]) || [],
      eventId: event.id,
      ts: event.ts
    };
    
    if (args.from) comm.from = args.from as string;
    if (args.topic) comm.topic = args.topic as string;
    if (args.in_response_to) comm.inResponseTo = args.in_response_to as string;
    
    comms.push(comm);
  }
  
  return comms;
}

export function extractDiscovery(events: { action: string; args: Record<string, unknown>; id: string }[]): Discovery | undefined {
  const discoveryEvent = events.find(e => e.action === "Discovering.completed");
  if (!discoveryEvent) return undefined;

  const args = discoveryEvent.args;
  const codebaseMap = args.codebase_map as { module_summaries?: Array<{ path: string; summary: string }> } | undefined;
  const hotPathHyp = args.hot_path_hypothesis as { description?: string; reasoning?: string } | undefined;
  const benchmark = args.benchmark as {
    origin?: "found" | "wrote";
    path?: string;
    command?: string;
    primary_metric?: { key: string; direction: "lower_better" | "higher_better" };
    secondary_metrics?: string[];
    noise_floor?: { primary_metric_value_runs?: number[]; spread_pct?: number };
  } | undefined;

  return {
    codebaseMap: {
      moduleSummaries: (codebaseMap?.module_summaries || []) as ModuleSummary[]
    },
    hotPathHypothesis: {
      description: hotPathHyp?.description || "",
      reasoning: hotPathHyp?.reasoning || ""
    },
    benchmark: {
      origin: benchmark?.origin || "found",
      path: benchmark?.path || "",
      command: benchmark?.command,
      primaryMetric: benchmark?.primary_metric || { key: "unknown", direction: "lower_better" },
      secondaryMetrics: benchmark?.secondary_metrics || [],
      noiseFloor: {
        primaryMetricValueRuns: benchmark?.noise_floor?.primary_metric_value_runs || [],
        spreadPct: benchmark?.noise_floor?.spread_pct || 0
      }
    },
    openQuestions: (args.open_questions as string[]) || [],
    eventId: discoveryEvent.id
  };
}

export function buildModifications(events: EventNode[]): Modification[] {
  const mods: Modification[] = [];
  const modMap = new Map<string, Modification>();
  
  for (const event of events) {
    if (event.action === "Modifying.applied") {
      const args = event.args;
      const changeId = args.change_id as string;
      
      const mod: Modification = {
        changeId,
        files: (args.files as string[]) || [args.to as string].filter(Boolean),
        fromHypothesis: args.from_hypothesis as string || "",
        summary: args.summary as string || "",
        diffBrief: args.diff_brief as string || "",
        eventId: event.id,
        reverted: false
      };
      
      modMap.set(changeId, mod);
      mods.push(mod);
    } else if (event.action === "Modifying.reverted") {
      const changeId = event.args.change_id as string;
      const mod = modMap.get(changeId);
      if (mod) mod.reverted = true;
    }
  }
  
  return mods;
}

export function computeStats(experiments: Experiment[], metricDirection: "lower_better" | "higher_better") {
  const kept = experiments.filter(e => e.outcome === "kept");
  const discarded = experiments.filter(e => e.outcome === "discarded");
  const crashed = experiments.filter(e => e.outcome === "crashed");
  const belowNoise = experiments.filter(e => e.outcome === "below_noise");
  
  const baseline = experiments[0];
  const baselineValue = baseline?.measurement?.primary?.value || 0;
  
  let currentBest = baselineValue;
  for (const exp of kept) {
    if (exp.measurement?.primary?.value) {
      const val = exp.measurement.primary.value;
      if (metricDirection === "lower_better" ? val < currentBest : val > currentBest) {
        currentBest = val;
      }
    }
  }
  
  const improvementPercent = baselineValue 
    ? ((baselineValue - currentBest) / baselineValue) * 100
    : 0;
  
  return {
    totalExperiments: experiments.length,
    keptExperiments: kept.length,
    discardedExperiments: discarded.length + belowNoise.length,
    crashedExperiments: crashed.length,
    currentBest,
    baselineValue,
    improvementPercent,
    totalEvents: 0 // will be set later
  };
}
