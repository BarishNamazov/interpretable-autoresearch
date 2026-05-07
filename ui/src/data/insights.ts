// Auto-derived insights from a UIRunProjection. No LLM call.
import type { UIHypothesis, UIRunProjection } from "./projection.ts";

export interface InsightStats {
  totalHypotheses: number;
  confirmed: number;
  violated: number;
  partial: number;
  pending: number;
  discarded: number;
  hitRate: number; // confirmed / (confirmed + violated + partial)
}

export interface ThemeInsight {
  /** A short, hand-rollable theme label like "lr", "noise floor", "checksum". */
  theme: string;
  /** Hypotheses tagged with this theme (by simple keyword match in description). */
  hypotheses: UIHypothesis[];
  confirmed: number;
  violated: number;
  partial: number;
}

export interface NoiseFloorInsight {
  declaredAboveNoiseButRegression: number;
  pairs: Array<{ experimentId: string; declared: string; inferred: string; valDelta: string }>;
}

export interface Insights {
  stats: InsightStats;
  themes: ThemeInsight[];
  noiseFloor: NoiseFloorInsight | null;
  freestyleSummary: { count: number; reasons: string[] };
}

const _STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "to", "of", "in", "on", "at", "for", "with", "by",
  "is", "are", "was", "were", "be", "been", "this", "that", "from", "as", "it", "its",
  "lower", "higher", "magnitude", "direction", "mechanism", "expected", "predicted",
]);

function statusBuckets(hypotheses: UIHypothesis[]): InsightStats {
  let confirmed = 0,
    violated = 0,
    partial = 0,
    pending = 0,
    discarded = 0;
  for (const h of hypotheses) {
    switch (h.status) {
      case "confirmed":
        confirmed++;
        break;
      case "violated":
        violated++;
        break;
      case "partial":
        partial++;
        break;
      case "pending":
        pending++;
        break;
      case "discarded":
        discarded++;
        break;
    }
  }
  const tested = confirmed + violated + partial;
  return {
    totalHypotheses: hypotheses.length,
    confirmed,
    violated,
    partial,
    pending,
    discarded,
    hitRate: tested ? confirmed / tested : 0,
  };
}

function discoverThemes(hypotheses: UIHypothesis[]): ThemeInsight[] {
  // Tokenize descriptions, count words, pick top buckets, group hypotheses.
  const counts = new Map<string, number>();
  for (const h of hypotheses) {
    const words = h.description.toLowerCase().split(/[^a-z0-9_]+/);
    const seen = new Set<string>();
    for (const w of words) {
      if (w.length < 3) continue;
      if (_STOPWORDS.has(w)) continue;
      if (seen.has(w)) continue;
      seen.add(w);
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  }
  const topThemes = Array.from(counts.entries())
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([theme]) => theme);

  const themes: ThemeInsight[] = [];
  for (const theme of topThemes) {
    const matched = hypotheses.filter((h) => h.description.toLowerCase().includes(theme));
    let confirmed = 0,
      violated = 0,
      partial = 0;
    for (const h of matched) {
      if (h.status === "confirmed") confirmed++;
      else if (h.status === "violated") violated++;
      else if (h.status === "partial") partial++;
    }
    themes.push({ theme, hypotheses: matched, confirmed, violated, partial });
  }
  return themes;
}

function noiseFloorInsight(run: UIRunProjection): NoiseFloorInsight | null {
  const pairs: NoiseFloorInsight["pairs"] = [];
  for (const e of run.events) {
    if (e.action !== "Communicating.surfaced") continue;
    const msg = e.args["message"];
    if (typeof msg !== "string") continue;
    const m = msg.match(/significance='?(\w+)'?\s+disagrees with inferred='?(\w+)'?/);
    if (!m) continue;
    pairs.push({ experimentId: e.causedBy[0] ?? "", declared: m[1], inferred: m[2], valDelta: msg });
  }
  if (pairs.length === 0) return null;
  const aboveButRegression = pairs.filter(
    (p) => p.declared === "above_noise" && p.inferred === "below_noise"
  ).length;
  return { declaredAboveNoiseButRegression: aboveButRegression, pairs };
}

function freestyleSummary(run: UIRunProjection): Insights["freestyleSummary"] {
  const reasons: string[] = [];
  for (const e of run.freestyles) {
    const r = e.args["reason"] ?? e.args["message"] ?? e.args["why"];
    if (typeof r === "string" && r) reasons.push(r);
  }
  return { count: run.freestyles.length, reasons: reasons.slice(0, 5) };
}

export function deriveInsights(run: UIRunProjection): Insights {
  return {
    stats: statusBuckets(run.hypotheses),
    themes: discoverThemes(run.hypotheses),
    noiseFloor: noiseFloorInsight(run),
    freestyleSummary: freestyleSummary(run),
  };
}
