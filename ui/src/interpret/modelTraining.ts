import type { RawEvent, Run } from "../types.ts";
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

export function interpretModelTraining(rawEvents: RawEvent[]): Run {
  const { events, eventsById } = buildEventNodes(rawEvents);
  const experiments = buildExperiments(events, eventsById);
  const hypotheses = buildHypotheses(events);
  
  linkHypothesesToExperiments(experiments, hypotheses);
  
  const metricSeries = buildMetricSeries(experiments, "lower_better");
  const communications = buildCommunications(events);
  const modifications = buildModifications(events);
  const discovery = extractDiscovery(events);
  
  const stats = computeStats(experiments, "lower_better");
  stats.totalEvents = events.length;
  
  const agentId = events[0]?.raw?.by || "unknown";
  const startedAt = events[0]?.ts || new Date();
  
  return {
    domain: "model-training",
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
    stats
  };
}
