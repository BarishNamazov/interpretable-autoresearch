// Strict event-log parser. Replaces the lenient parse.ts with one that
// flags malformed events but never throws.
import type { RawEvent } from "../types.ts";

export interface ParseResult {
  events: RawEvent[];
  errors: string[];
}

export function parseEventsStrict(jsonl: string): ParseResult {
  const events: RawEvent[] = [];
  const errors: string[] = [];
  if (!jsonl.trim()) return { events, errors };
  const lines = jsonl.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (!line) continue;
    try {
      const ev = JSON.parse(line) as Partial<RawEvent>;
      if (typeof ev.event_id !== "string" || typeof ev.action !== "string") {
        errors.push(`line ${i + 1}: missing event_id or action`);
        continue;
      }
      if (!Array.isArray(ev.caused_by)) ev.caused_by = [];
      if (!ev.args || typeof ev.args !== "object") ev.args = {};
      if (typeof ev.ts !== "string") ev.ts = "";
      if (typeof ev.by !== "string") ev.by = "";
      events.push(ev as RawEvent);
    } catch (e) {
      errors.push(`line ${i + 1}: invalid json (${(e as Error).message})`);
    }
  }
  return { events, errors };
}
