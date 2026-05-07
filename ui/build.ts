import { mkdir, rm, cp } from "node:fs/promises";

const OUT = "./dist";

async function loadDomain(domain: string) {
  const events = Bun.file(`../${domain}/events.jsonl`);
  const program = Bun.file(`../${domain}/program.md`);
  return {
    events: (await events.exists()) ? await events.text() : "",
    program: (await program.exists()) ? await program.text() : "",
  };
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const runs = {
  "model-training": await loadDomain("model-training"),
  "performance-engineering": await loadDomain("performance-engineering"),
};
await Bun.write(`${OUT}/runs.json`, JSON.stringify(runs));

const result = await Bun.build({
  entrypoints: ["./src/main.ts"],
  outdir: OUT,
  target: "browser",
  minify: true,
  naming: "[dir]/[name].js",
});
if (!result.success) {
  console.error(result.logs);
  process.exit(1);
}

await cp("./src/styles/tokens.css", `${OUT}/styles.css`);

const html = (await Bun.file("./index.html").text())
  .replace('href="./src/styles/tokens.css"', 'href="./styles.css"')
  .replace('src="./src/main.ts"', 'src="./main.js"');
await Bun.write(`${OUT}/index.html`, html);

console.log(`Built to ${OUT}/`);
