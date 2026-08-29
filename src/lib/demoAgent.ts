import type { DiffLine, Patch, ToolCall } from "@/types";

export interface DemoHandlers {
  onToolCall: (t: ToolCall) => void;
  onToolUpdate: (id: string, status: ToolCall["status"], durationMs?: number) => void;
  onPatch: (p: Patch) => void;
  onDelta: (text: string) => void;
  onDone: (usage: { input: number; output: number }) => void;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function diff(lines: DiffLine[]): DiffLine[] {
  return lines;
}

const RATE_LIMIT_PATCH: DiffLine[] = diff([
  { type: "ctx", text: 'import http from "node:http";' },
  { type: "add", text: 'import { allow } from "./rate-limit.js";' },
  { type: "ctx", text: "" },
  { type: "ctx", text: "const PORT = Number(process.env.PORT ?? 8080);" },
  { type: "del", text: "" },
  { type: "add", text: "" },
  { type: "add", text: "const WINDOW_MS = 60_000;" },
  { type: "add", text: "const MAX_REQUESTS = 60;" },
  { type: "ctx", text: "" },
  { type: "ctx", text: "const server = http.createServer((req, res) => {" },
  { type: "add", text: '  const key = req.socket.remoteAddress ?? "anon";' },
  { type: "add", text: "  if (!allow(key, MAX_REQUESTS, WINDOW_MS)) {" },
  { type: "add", text: '    res.writeHead(429, { "retry-after": "60" });' },
  { type: "add", text: '    res.end("rate limit exceeded");' },
  { type: "add", text: "    return;" },
  { type: "add", text: "  }" },
  { type: "ctx", text: '  if (req.url === "/health") {' },
  { type: "del", text: '    res.writeHead(200, { "content-type": "application/json" });' },
  { type: "add", text: '    res.writeHead(200, { "content-type": "application/json", "x-rate-limit": String(MAX_REQUESTS) });' },
  { type: "ctx", text: '    res.end(JSON.stringify({ ok: true }));' },
  { type: "ctx", text: "    return;" },
  { type: "ctx", text: "  }" },
]);

const GENERIC_PATCH: DiffLine[] = diff([
  { type: "ctx", text: "# edge-api" },
  { type: "ctx", text: "" },
  { type: "del", text: "Tiny HTTP edge service. `GET /health` returns liveness." },
  { type: "add", text: "Tiny HTTP edge service with token-bucket rate limiting." },
  { type: "add", text: "" },
  { type: "add", text: "- `GET /health` — liveness probe" },
  { type: "add", text: "- 60 req/min per client IP, `429` + `Retry-After` on overflow" },
  { type: "ctx", text: "" },
  { type: "ctx", text: "## Run" },
]);

/**
 * Simulated agent run for Demo mode — mimics the plan → tool calls → patch
 * loop of a real coding agent without burning API tokens.
 */
export async function runDemoAgent(prompt: string, h: DemoHandlers, isCancelled: () => boolean): Promise<void> {
  const wantsRateLimit = /rate|limit|throttl|429/i.test(prompt);
  const patchFile = wantsRateLimit ? "src/server.ts" : "README.md";
  const patchLines = wantsRateLimit ? RATE_LIMIT_PATCH : GENERIC_PATCH;

  const tool = (id: string, kind: ToolCall["kind"], title: string, detail: string): ToolCall => ({
    id, kind, title, detail, status: "running",
  });

  const t1 = tool("t1", "think", "Planning", wantsRateLimit
    ? "Goal: per-IP rate limiting. Reuse existing token bucket in src/rate-limit.ts, wire into createServer before route handling."
    : "Goal: " + prompt.slice(0, 90) + ". Scoping the smallest useful change across the project.");
  h.onToolCall(t1);
  await wait(900);
  if (isCancelled()) return;
  h.onToolUpdate("t1", "done", 880);

  const t2 = tool("t2", "read_file", "Read src/rate-limit.ts", "Token-bucket implementation, exports allow(key, limit, perMs)");
  h.onToolCall(t2);
  await wait(650);
  if (isCancelled()) return;
  h.onToolUpdate("t2", "done", 610);

  const t3 = tool("t3", "read_file", `Read ${patchFile}`, wantsRateLimit ? "HTTP server entry — inject limiter at top of request handler" : "Project readme — document the change");
  h.onToolCall(t3);
  await wait(550);
  if (isCancelled()) return;
  h.onToolUpdate("t3", "done", 520);

  const t4 = tool("t4", "edit_file", `Edit ${patchFile}`, `${patchLines.filter((l) => l.type === "add").length} additions, ${patchLines.filter((l) => l.type === "del").length} deletions`);
  h.onToolCall(t4);
  await wait(800);
  if (isCancelled()) return;
  h.onToolUpdate("t4", "done", 760);
  h.onPatch({ file: patchFile, lines: patchLines, status: "pending" });

  const t5 = tool("t5", "run_command", "npm run build", "typecheck + bundle");
  h.onToolCall(t5);
  await wait(1100);
  if (isCancelled()) return;
  h.onToolUpdate("t5", "done", 1040);

  const summary = wantsRateLimit
    ? `Done. **Rate limiting is wired into \`src/server.ts\`:**\n\n- Imported the existing token bucket from \`./rate-limit.js\` — no new dependencies.\n- Every request now passes \`allow(ip, 60, 60_000)\` before routing; overflow gets \`429\` with a \`Retry-After: 60\` header.\n- \`/health\` responses carry \`x-rate-limit\` so probes can observe the policy.\n\nReview the diff above — **Apply** writes it to the workspace, **Reject** discards it. Connect a nano-gpt API key to run this loop with a live model instead of the demo script.`
    : `Here's my plan for "**${prompt.slice(0, 80)}**":\n\n1. Scoped the change to \`${patchFile}\` — smallest surface that satisfies the request.\n2. Drafted the patch above (${patchLines.filter((l) => l.type === "add").length} additions, ${patchLines.filter((l) => l.type === "del").length} deletions) with a passing typecheck.\n3. **Apply** to write it, **Reject** to discard, or reply with corrections and I'll revise.\n\nTip: try *"add rate limiting to the server"* for the full agent loop, or connect your nano-gpt key for live model runs.`;

  for (const ch of summary.match(/[\s\S]{1,6}/g) ?? []) {
    if (isCancelled()) return;
    h.onDelta(ch);
    await wait(14);
  }
  h.onDone({ input: 2418, output: 512 });
}
