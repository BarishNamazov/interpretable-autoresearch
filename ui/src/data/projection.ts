// Concept-driven projection: log → derived state.
// The new UI does *not* branch on domain. The shape is the same for every
// program; per-concept fields are simply absent for programs that don't
// declare those concepts.
import type { RawEvent } from "../types.ts";

export type EventConcept = string; // e.g. "Hypothesizing"

export interface UIEvent {
  id: string;
  ts: string;
  tsDate: Date | null;
  by: string;
  action: string;
  concept: EventConcept;
  verb: string;
  args: Record<string, unknown>;
  causedBy: string[];
  /** Set of event ids that cite this event in their caused_by. */
  causes: string[];
  isFreestyle: boolean;
  /** The reaction (by name) that authorized this event, if any. */
  reactionName?: string;
  raw: RawEvent;
}

export interface UIPrediction {
  direction?: string;
  magnitude?: string;
  mechanism?: string;
  side_effects?: string;
}

export type HypothesisStatus = "pending" | "confirmed" | "violated" | "partial" | "discarded";

export interface UIHypothesis {
  id: string; // event_id
  description: string;
  reasoning: string;
  prediction: UIPrediction;
  ts: string;
  experimentId?: string;
  measurementValue?: number;
  outcomeText?: string;
  outcomeVsPrediction?: string;
  status: HypothesisStatus;
}

export interface UIExperiment {
  id: string;
  proposedEventId?: string;
  hypothesisId?: string;
  measurementValue?: number;
  measurementMetric?: string;
  measurementStatus?: "ok" | "crashed" | "tests_failed";
  significance?: "above_noise" | "below_noise";
  outcome: "kept" | "discarded" | "crashed" | "running" | "below_noise";
  outcomeVsPrediction?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface UIMetricPoint {
  experimentId: string;
  experimentIndex: number;
  value: number;
  bestSoFar: number;
  outcome: UIExperiment["outcome"];
  hypothesisDescription?: string;
  predictedDirection?: string;
  measureEventId: string;
}

export interface UIRunProjection {
  events: UIEvent[];
  eventsById: Map<string, UIEvent>;
  hypotheses: UIHypothesis[];
  experiments: UIExperiment[];
  metric: UIMetricPoint[];
  metricKey: string;
  metricDirection: "lower_better" | "higher_better";
  baseline?: number;
  best?: number;
  freestyles: UIEvent[];
  communications: UIEvent[];
  conceptCounts: Record<string, number>;
  warnings: string[]; // hook-warning Communicating.surfaced messages
}

const _PRIMARY_KEYS = ["primary_median_seconds", "val_bpb"];

function pickPrimary(args: Record<string, unknown>): { key?: string; value?: number } {
  const p = args["primary"];
  if (p && typeof p === "object" && p !== null) {
    const obj = p as Record<string, unknown>;
    if (typeof obj.key === "string" && typeof obj.value === "number") {
      return { key: obj.key, value: obj.value };
    }
  }
  if (typeof args["value"] === "number") {
    const k = (typeof args["metric"] === "string" ? (args["metric"] as string) : undefined) ?? _PRIMARY_KEYS[0];
    return { key: k, value: args["value"] as number };
  }
  return {};
}

export function projectRun(events: RawEvent[], actionToReaction?: Map<string, string>): UIRunProjection {
  // ---- normalize events ------------------------------------------------
  const uiEvents: UIEvent[] = events.map((raw) => {
    const [concept, verb] = raw.action.split(".", 2) as [string, string];
    const tsDate = raw.ts ? new Date(raw.ts) : null;
    const isFreestyle = concept === "Freestyling";
    return {
      id: raw.event_id,
      ts: raw.ts,
      tsDate: tsDate && !isNaN(tsDate.getTime()) ? tsDate : null,
      by: raw.by,
      action: raw.action,
      concept,
      verb: verb ?? "",
      args: raw.args ?? {},
      causedBy: raw.caused_by ?? [],
      causes: [],
      isFreestyle,
      reactionName: actionToReaction?.get(raw.action),
      raw,
    };
  });
  const eventsById = new Map<string, UIEvent>();
  for (const e of uiEvents) eventsById.set(e.id, e);
  for (const e of uiEvents) {
    for (const cb of e.causedBy) {
      const parent = eventsById.get(cb);
      if (parent) parent.causes.push(e.id);
    }
  }

  // ---- experiments + measurements -------------------------------------
  const experiments = new Map<string, UIExperiment>();
  for (const e of uiEvents) {
    if (e.action === "Experimenting.proposed") {
      const id = (e.args["experiment_id"] as string) ?? e.id;
      experiments.set(id, {
        id,
        proposedEventId: e.id,
        hypothesisId: (e.args["hypothesis_id"] as string) || undefined,
        outcome: "running",
      });
    } else if (e.action === "Experimenting.run") {
      const id = (e.args["experiment_id"] as string) ?? "";
      const exp = experiments.get(id) ?? { id, outcome: "running" as const };
      exp.startedAt = (e.args["started_at"] as string) ?? exp.startedAt;
      exp.finishedAt = (e.args["finished_at"] as string) ?? exp.finishedAt;
      experiments.set(id, exp);
    } else if (e.action === "Evaluating.measured") {
      const id = (e.args["experiment_id"] as string) ?? "";
      const exp = experiments.get(id) ?? { id, outcome: "running" as const };
      const { key, value } = pickPrimary(e.args);
      exp.measurementValue = value;
      exp.measurementMetric = key;
      exp.measurementStatus = (e.args["status"] as UIExperiment["measurementStatus"]) ?? "ok";
      exp.significance = e.args["significance"] as UIExperiment["significance"];
      if (exp.measurementStatus === "crashed") exp.outcome = "crashed";
      else if (exp.significance === "below_noise") exp.outcome = "below_noise";
      experiments.set(id, exp);
    } else if (e.action === "Experimenting.kept") {
      const id = (e.args["experiment_id"] as string) ?? "";
      const exp = experiments.get(id) ?? { id, outcome: "kept" as const };
      exp.outcome = "kept";
      experiments.set(id, exp);
    } else if (e.action === "Experimenting.discarded") {
      const id = (e.args["experiment_id"] as string) ?? "";
      const exp = experiments.get(id) ?? { id, outcome: "discarded" as const };
      // Don't overwrite a 'crashed' or 'below_noise' classification.
      if (exp.outcome !== "crashed" && exp.outcome !== "below_noise") exp.outcome = "discarded";
      experiments.set(id, exp);
    } else if (e.action === "Logging.recorded") {
      const id = (e.args["experiment_id"] as string) ?? "";
      const exp = experiments.get(id) ?? { id, outcome: "running" as const };
      exp.outcomeVsPrediction = (e.args["outcome_vs_prediction"] as string) ?? exp.outcomeVsPrediction;
      experiments.set(id, exp);
    }
  }

  // ---- hypotheses + status --------------------------------------------
  const hypotheses: UIHypothesis[] = [];
  for (const e of uiEvents) {
    if (e.action !== "Hypothesizing.formed") continue;
    const pred = (e.args["prediction"] as UIPrediction) ?? {};
    const informedExperiment = (e.args["informed_by_experiment"] as string) || undefined;
    void informedExperiment;
    // Find the next experiment that resolved after this hypothesis (by event order).
    const idx = uiEvents.indexOf(e);
    let expId: string | undefined;
    for (let k = idx + 1; k < uiEvents.length; k++) {
      const ev = uiEvents[k];
      if (ev.action === "Experimenting.proposed" && (ev.args["hypothesis_id"] as string) === e.id) {
        expId = ev.args["experiment_id"] as string;
        break;
      }
      if (ev.action === "Modifying.applied" && (ev.args["from_hypothesis"] === e.id || (ev.args["from_hypothesis_id"] as string) === e.id)) {
        // Walk further to find the experiment.
        for (let m = k + 1; m < uiEvents.length; m++) {
          if (uiEvents[m].action === "Experimenting.proposed") {
            expId = uiEvents[m].args["experiment_id"] as string;
            break;
          }
        }
        break;
      }
    }
    let status: HypothesisStatus = "pending";
    let value: number | undefined;
    let outcomeVsPrediction: string | undefined;
    if (expId) {
      const exp = experiments.get(expId);
      if (exp) {
        value = exp.measurementValue;
        outcomeVsPrediction = exp.outcomeVsPrediction;
        if (exp.outcome === "kept") status = "confirmed";
        else if (exp.outcome === "discarded") status = "violated";
        else if (exp.outcome === "below_noise") status = "partial";
        else if (exp.outcome === "crashed") status = "discarded";
      }
    }
    hypotheses.push({
      id: e.id,
      description: (e.args["description"] as string) ?? "",
      reasoning: (e.args["reasoning"] as string) ?? "",
      prediction: pred,
      ts: e.ts,
      experimentId: expId,
      measurementValue: value,
      outcomeVsPrediction,
      status,
    });
  }

  // ---- metric series ---------------------------------------------------
  const metricPoints: UIMetricPoint[] = [];
  let metricKey = "metric";
  let metricDirection: "lower_better" | "higher_better" = "lower_better";
  // Try to read direction from a Discovering.completed.benchmark.primary_metric.direction.
  for (const e of uiEvents) {
    if (e.action === "Discovering.completed") {
      const bench = (e.args["benchmark"] as Record<string, unknown> | undefined) ?? {};
      const pm = (bench["primary_metric"] as Record<string, unknown> | undefined) ?? {};
      if (typeof pm["direction"] === "string" && (pm["direction"] === "lower_better" || pm["direction"] === "higher_better")) {
        metricDirection = pm["direction"] as "lower_better" | "higher_better";
      }
      if (typeof pm["key"] === "string") metricKey = pm["key"] as string;
      break;
    }
  }
  let bestSoFar: number | undefined;
  let baseline: number | undefined;
  let expIndex = 0;
  for (const e of uiEvents) {
    if (e.action !== "Evaluating.measured") continue;
    const { key, value } = pickPrimary(e.args);
    if (typeof value !== "number") continue;
    if (key) metricKey = key;
    const expId = (e.args["experiment_id"] as string) ?? "";
    const exp = experiments.get(expId);
    const status = exp?.outcome ?? "running";
    const better =
      bestSoFar === undefined
        ? true
        : metricDirection === "lower_better"
          ? value < bestSoFar
          : value > bestSoFar;
    if (status === "kept" && better) bestSoFar = value;
    else if (bestSoFar === undefined && status === "kept") bestSoFar = value;
    if (baseline === undefined) baseline = value;
    // Find the hypothesis description (if any).
    let hypDesc: string | undefined;
    let predDir: string | undefined;
    if (exp?.hypothesisId) {
      const h = hypotheses.find((h) => h.id === exp.hypothesisId);
      if (h) {
        hypDesc = h.description;
        predDir = h.prediction.direction;
      }
    } else {
      // Fall back: nearest preceding hypothesis.
      const idx = uiEvents.indexOf(e);
      for (let k = idx - 1; k >= 0; k--) {
        if (uiEvents[k].action === "Hypothesizing.formed") {
          hypDesc = (uiEvents[k].args["description"] as string) ?? undefined;
          const pred = uiEvents[k].args["prediction"] as UIPrediction | undefined;
          predDir = pred?.direction;
          break;
        }
      }
    }
    metricPoints.push({
      experimentId: expId,
      experimentIndex: expIndex++,
      value,
      bestSoFar: bestSoFar ?? value,
      outcome: status,
      hypothesisDescription: hypDesc,
      predictedDirection: predDir,
      measureEventId: e.id,
    });
  }

  // ---- communications + freestyles + warnings -------------------------
  const communications = uiEvents.filter((e) => e.concept === "Communicating");
  const freestyles = uiEvents.filter((e) => e.isFreestyle);
  const warnings: string[] = [];
  for (const e of communications) {
    if (e.args["topic"] === "hook-warning" && typeof e.args["message"] === "string") {
      warnings.push(e.args["message"] as string);
    }
  }

  const conceptCounts: Record<string, number> = {};
  for (const e of uiEvents) conceptCounts[e.concept] = (conceptCounts[e.concept] ?? 0) + 1;

  return {
    events: uiEvents,
    eventsById,
    hypotheses,
    experiments: Array.from(experiments.values()),
    metric: metricPoints,
    metricKey,
    metricDirection,
    baseline,
    best: bestSoFar,
    freestyles,
    communications,
    conceptCounts,
    warnings,
  };
}
