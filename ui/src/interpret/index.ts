import type { Domain, RawEvent, Run } from "../types.ts";
import { interpretModelTraining } from "./modelTraining.ts";
import { interpretPerformanceEngineering } from "./performanceEngineering.ts";

export function interpret(domain: Domain, rawEvents: RawEvent[]): Run {
  switch (domain) {
    case "model-training":
      return interpretModelTraining(rawEvents);
    case "performance-engineering":
      return interpretPerformanceEngineering(rawEvents);
    default:
      throw new Error(`Unknown domain: ${domain}`);
  }
}

export { interpretModelTraining } from "./modelTraining.ts";
export { interpretPerformanceEngineering } from "./performanceEngineering.ts";
export { domainHandlers, getHandler } from "./handlers.ts";
