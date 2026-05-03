import type { 
  RawEvent, 
  Run, 
  Profile,
  HotAttribution
} from "../types.ts";
import { 
  buildEventNodes, 
  buildExperiments, 
  buildHypotheses, 
  linkHypothesesToExperiments,
  buildMetricSeries,
  buildCommunications,
  buildModifications,
  computeStats,
  extractDiscovery
} from "./shared.ts";

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
