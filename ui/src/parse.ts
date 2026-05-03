import type { RawEvent } from "./types.ts";

export function parseEvents(jsonl: string): RawEvent[] {
  if (!jsonl.trim()) return [];
  
  const events: RawEvent[] = [];
  const lines = jsonl.trim().split("\n");
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    try {
      const event = JSON.parse(line) as RawEvent;
      
      // Validate required fields
      if (!event.event_id || !event.action) {
        console.warn(`Skipping malformed event at line ${i + 1}: missing required fields`);
        continue;
      }
      
      // Ensure caused_by is always an array
      if (!Array.isArray(event.caused_by)) {
        event.caused_by = [];
      }
      
      // Ensure args is always an object
      if (!event.args || typeof event.args !== "object") {
        event.args = {};
      }
      
      events.push(event);
    } catch (err) {
      console.warn(`Skipping malformed JSON at line ${i + 1}:`, err);
    }
  }
  
  return events;
}
