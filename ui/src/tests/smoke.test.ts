// Renders the bundled main.js into a happy-dom Window, mocking fetch so the
// app gets fixture data. Asserts the inspector reacts to a selectedEventId.
import { describe, expect, it } from "bun:test";
import { Window } from "happy-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const UI_DIR = resolve(import.meta.dir, "..", "..");

describe("end-to-end smoke", () => {
  it("renders the three-pane layout against fixtures and reacts to selection", async () => {
    const w = new Window({ url: "http://localhost/" });
    const doc = w.document;

    // Inject the css + a host element.
    doc.body.innerHTML = `<div id="app"></div>`;

    // Build the fixture from the live fixtures so the test does not depend
    // on a stale `dist/runs.json` (which would only exist after `bun run build`).
    const fixture: Record<string, { events: string; program: string }> = {};
    for (const domain of ["model-training", "performance-engineering"]) {
      const eventsPath = resolve(UI_DIR, "..", domain, "events.jsonl");
      const programPath = resolve(UI_DIR, "..", domain, "program.md");
      fixture[domain] = {
        events: readFileSync(eventsPath, "utf-8"),
        program: readFileSync(programPath, "utf-8"),
      };
    }
    // Stub fetch.
    (w as unknown as { fetch: (u: string) => Promise<Response> }).fetch = async (url: string) => {
      if (url === "/api/runs" || url.endsWith("runs.json")) {
        return new Response(JSON.stringify(fixture), { headers: { "content-type": "application/json" } });
      }
      return new Response("not found", { status: 404 });
    };

    // Make the global window/document available to ESM code under test.
    (w as unknown as { SyntaxError: typeof SyntaxError }).SyntaxError = SyntaxError;
    (globalThis as unknown as { window: Window }).window = w;
    (globalThis as unknown as { document: typeof doc }).document = doc;
    (globalThis as unknown as { fetch: typeof w.fetch }).fetch = w.fetch.bind(w);
    (globalThis as unknown as { Node: unknown }).Node = w.Node;
    (globalThis as unknown as { HTMLElement: unknown }).HTMLElement = w.HTMLElement;

    // Dynamically import the entry; tsx-equivalent via ts-loader Bun has built-in.
    const mod = await import("../components/App.ts");
    await mod.initApp(doc.getElementById("app") as unknown as HTMLElement);

    // Wait a tick for async loadRuns + rendering.
    await new Promise((r) => setTimeout(r, 60));

    const rows = doc.querySelectorAll(".event-row");
    expect(rows.length).toBeGreaterThan(0);

    // Click the first event → inspector should reveal a Causal chain section.
    (rows[0] as unknown as { click: () => void }).click();
    await new Promise((r) => setTimeout(r, 30));
    const text = doc.body.textContent ?? "";
    expect(text).toContain("Causal chain");

    w.close();
  });
});
