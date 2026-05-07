// Loads run data from /api/runs (live) or runs.json (static deploy).
import type { ApiResponse, DomainData } from "../types.ts";

export async function loadRuns(): Promise<ApiResponse> {
  // Prefer the live API; fall back to the static bundle next to index.html.
  const candidates = ["/api/runs", "./runs.json"];
  let lastErr: unknown;
  for (const url of candidates) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        lastErr = new Error(`${url} → ${res.status}`);
        continue;
      }
      const data = (await res.json()) as ApiResponse;
      if (!data || typeof data !== "object") {
        lastErr = new Error(`${url} returned invalid payload`);
        continue;
      }
      return data;
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`could not load run data: ${(lastErr as Error)?.message ?? lastErr}`);
}

export type { DomainData };
