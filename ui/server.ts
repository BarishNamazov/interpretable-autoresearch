const PORT = 3000;

async function loadDomainData(domain: string): Promise<{ events: string; program: string }> {
  const basePath = `../${domain}`;
  const eventsFile = Bun.file(`${basePath}/events.jsonl`);
  const programFile = Bun.file(`${basePath}/program.md`);
  
  const [events, program] = await Promise.all([
    eventsFile.exists().then(e => e ? eventsFile.text() : ""),
    programFile.exists().then(e => e ? programFile.text() : "")
  ]);
  
  return { events, program };
}

const server = Bun.serve({
  port: PORT,
  
  async fetch(req) {
    const url = new URL(req.url);
    
    // API routes
    if (url.pathname === "/api/runs" || url.pathname === "/runs.json") {
      try {
        const [modelTraining, performanceEngineering] = await Promise.all([
          loadDomainData("model-training"),
          loadDomainData("performance-engineering")
        ]);
        
        return Response.json({
          "model-training": modelTraining,
          "performance-engineering": performanceEngineering
        });
      } catch (err) {
        console.error("Error loading runs:", err);
        return Response.json({ error: "Failed to load runs" }, { status: 500 });
      }
    }
    
    if (url.pathname.startsWith("/api/runs/")) {
      const domain = url.pathname.replace("/api/runs/", "");
      try {
        const data = await loadDomainData(domain);
        return Response.json(data);
      } catch (err) {
        console.error(`Error loading domain ${domain}:`, err);
        return Response.json({ error: `Failed to load domain: ${domain}` }, { status: 500 });
      }
    }
    
    // Static file serving for CSS
    if (url.pathname.startsWith("/src/") && url.pathname.endsWith(".css")) {
      const cssPath = `.${url.pathname}`;
      const cssFile = Bun.file(cssPath);
      if (await cssFile.exists()) {
        return new Response(cssFile, {
          headers: { "Content-Type": "text/css" }
        });
      }
    }
    
    // Serve index.html for root
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const htmlFile = Bun.file("./index.html");
      return new Response(htmlFile, {
        headers: { "Content-Type": "text/html" }
      });
    }
    
    // Serve TypeScript files
    if (url.pathname.endsWith(".ts")) {
      const tsPath = `.${url.pathname}`;
      const tsFile = Bun.file(tsPath);
      if (await tsFile.exists()) {
        // Transpile TypeScript to JavaScript for browser
        const result = await Bun.build({
          entrypoints: [tsPath],
          target: "browser",
        });
        if (result.outputs[0]) {
          return new Response(result.outputs[0], {
            headers: { "Content-Type": "application/javascript" }
          });
        }
      }
    }
    
    return new Response("Not Found", { status: 404 });
  }
});

console.log(`🔭 AutoResearch Observatory running at http://localhost:${server.port}`);
