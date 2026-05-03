import type { 
  RawEvent, 
  Run, 
  Discovery, 
  Profile,
  HotAttribution,
  ModuleSummary
} from "../types.ts";
import { 
  buildEventNodes, 
  buildExperiments, 
  buildHypotheses, 
  linkHypothesesToExperiments,
  buildMetricSeries,
  buildCommunications,
  buildModifications,
  computeStats
} from "./shared.ts";

function extractDiscovery(events: { action: string; args: Record<string, unknown>; id: string }[]): Discovery | undefined {
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

function extractProfiles(events: { action: string; args: Record<string, unknown>; id: string }[], hypotheses: { informedByProfile?: string; id: string }[]): Profile[] {
  const profiles: Profile[] = [];
  
  for (const event of events) {
    if (event.action !== "Profiling.profiled") continue;
    
    const args = event.args;
    
    // Find hypotheses informed by this profile
    const profileEventId = event.id;
    const informedHypotheses = hypotheses
      .filter(h => h.informedByProfile === profileEventId)
      .map(h => h.id);
    
    const hotAttr = args.hot_attribution as Array<{ function: string; percent_of_total: number | string }> | undefined;
    
    const profile: Profile = {
      id: args.profile_id as string,
      tool: args.tool as string || "unknown",
      target: args.target as string || "benchmark",
      hotAttribution: (hotAttr || []).map(a => ({
        function: a.function,
        percent_of_total: a.percent_of_total
      })) as HotAttribution[],
      staleAfter: args.stale_after as string | undefined,
      notes: args.notes as string | undefined,
      eventId: event.id,
      informedHypotheses
    };
    
    profiles.push(profile);
  }
  
  return profiles;
}

export function interpretPerformanceEngineering(rawEvents: RawEvent[]): Run {
  const { events, eventsById } = buildEventNodes(rawEvents);
  const experiments = buildExperiments(events, eventsById);
  const hypotheses = buildHypotheses(events);
  
  linkHypothesesToExperiments(experiments, hypotheses);
  
  const metricSeries = buildMetricSeries(experiments, "lower_better");
  const communications = buildCommunications(events);
  const modifications = buildModifications(events);
  
  const discovery = extractDiscovery(events);
  const profiles = extractProfiles(events, hypotheses);
  
  const stats = computeStats(experiments, "lower_better");
  stats.totalEvents = events.length;
  
  const agentId = events[0]?.raw?.by || "unknown";
  const startedAt = events[0]?.ts || new Date();
  
  return {
    domain: "performance-engineering",
    agentId,
    startedAt,
    events,
    eventsById,
    experiments,
    hypotheses,
    metricSeries,
    communications,
    modifications,
    discovery,
    profiles,
    stats
  };
}
