// pi extension for the Interpretable AutoResearch harness.
//
// Spawns `iar serve --program ... --events ... --hooks ...` as a subprocess
// and proxies four custom tools to it via newline-delimited JSON-RPC over
// stdio. The four tools are the *only* way the LLM can interact with the
// event log: write/edit on events.jsonl is denied at the permission layer.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { resolve } from "node:path";

interface ExtensionAPI {
  registerTool: (def: ToolDef) => void;
  registerCommand: (name: string, def: CommandDef) => void;
  on: (event: string, handler: (e: unknown, ctx: unknown) => unknown) => void;
  config?: Record<string, unknown>;
}

interface ToolDef {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  handler: (input: Record<string, unknown>) => Promise<unknown>;
}

interface CommandDef {
  description: string;
  handler: (args: string[]) => Promise<void>;
}

class HarnessRpc {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  private buf = "";

  constructor(
    private opts: {
      pythonBin?: string;
      programPath: string;
      eventsPath: string;
      hooksPath: string;
      agentId: string;
      cwd: string;
    },
  ) {}

  start(): void {
    if (this.proc) return;
    const py = this.opts.pythonBin || process.env.IAR_PYTHON || "python3";
    this.proc = spawn(
      py,
      [
        "-m",
        "iar_harness.cli",
        "--agent-id",
        this.opts.agentId,
        "serve",
        "--program",
        this.opts.programPath,
        "--events",
        this.opts.eventsPath,
        "--hooks",
        this.opts.hooksPath,
      ],
      { cwd: this.opts.cwd, stdio: ["pipe", "pipe", "pipe"] },
    );
    this.proc.stdout.setEncoding("utf-8");
    this.proc.stderr.setEncoding("utf-8");
    this.proc.stdout.on("data", (chunk: string) => {
      this.buf += chunk;
      let idx;
      while ((idx = this.buf.indexOf("\n")) >= 0) {
        const line = this.buf.slice(0, idx).trim();
        this.buf = this.buf.slice(idx + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          const slot = this.pending.get(msg.id);
          if (!slot) continue;
          this.pending.delete(msg.id);
          if (msg.error) slot.reject(new Error(String(msg.error)));
          else slot.resolve(msg.result);
        } catch {
          // ignore malformed line
        }
      }
    });
    this.proc.on("exit", (code) => {
      for (const slot of this.pending.values()) {
        slot.reject(new Error(`iar serve exited with code ${code}`));
      }
      this.pending.clear();
      this.proc = null;
    });
  }

  call<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    this.start();
    if (!this.proc) throw new Error("iar serve subprocess not running");
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params }) + "\n";
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.proc!.stdin.write(payload);
    });
  }

  stop(): void {
    if (!this.proc) return;
    this.proc.stdin.end();
    this.proc.kill("SIGTERM");
    this.proc = null;
  }
}

export default function (pi: ExtensionAPI): void {
  const cfg = (pi.config?.iar as Record<string, string> | undefined) || {};
  const cwd = resolve(cfg.cwd || process.cwd());
  const rpc = new HarnessRpc({
    pythonBin: cfg.python,
    programPath: cfg.program || "program.md",
    eventsPath: cfg.events || "events.jsonl",
    hooksPath: cfg.hooks || "hooks.py",
    agentId: cfg.agent_id || "autoresearch",
    cwd,
  });

  pi.registerTool({
    name: "tail_events",
    description: "Read the last N events from events.jsonl. Always call this before deciding what to do.",
    schema: { type: "object", properties: { n: { type: "integer", default: 20 } } },
    handler: async (input) => rpc.call("tail_events", { n: (input.n as number) ?? 20 }),
  });

  pi.registerTool({
    name: "next_reactions",
    description:
      "Return the set of reactions whose when/where currently match. You MAY only request/attest actions named in this list — anything else must go through Freestyling.",
    schema: { type: "object", properties: {} },
    handler: async () => rpc.call("next_reactions"),
  });

  pi.registerTool({
    name: "request",
    description:
      "Emit a Requesting.requested event AND run the matching @ground hook (which performs the real-world action — git, shell, file IO). Returns the canonical args you should use when emitting the corresponding attestation.",
    schema: {
      type: "object",
      required: ["action"],
      properties: {
        action: { type: "string", description: "e.g. Hypothesizing.form" },
        args: { type: "object" },
        caused_by: { type: "array", items: { type: "string" } },
      },
    },
    handler: async (input) => rpc.call("request", input),
  });

  pi.registerTool({
    name: "attest",
    description:
      "Append a past-tense attestation event (e.g. Hypothesizing.formed). Validators may reject; if they do, fix and retry.",
    schema: {
      type: "object",
      required: ["action"],
      properties: {
        action: { type: "string" },
        args: { type: "object" },
        caused_by: { type: "array", items: { type: "string" } },
      },
    },
    handler: async (input) => rpc.call("attest", input),
  });

  pi.registerCommand("iar-stop", {
    description: "Stop the iar harness subprocess.",
    handler: async () => rpc.stop(),
  });
}
