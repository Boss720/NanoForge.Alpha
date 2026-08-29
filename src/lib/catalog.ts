import type { NanoModel, VirtualFile } from "@/types";

/**
 * Offline snapshot of the nano-gpt.com coding-relevant catalog.
 * Prices are indicative USD per 1M tokens — when an API key is connected,
 * the live GET /api/v1/models response replaces this list.
 */
export const FALLBACK_MODELS: NanoModel[] = [
  { id: "gpt-5.2", name: "GPT-5.2", provider: "OpenAI", inputPrice: 1.75, outputPrice: 14.0, contextK: 400, tags: ["reasoning", "tools", "vision"] },
  { id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5", provider: "Anthropic", inputPrice: 3.0, outputPrice: 15.0, contextK: 200, tags: ["agentic", "tools", "vision"] },
  { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", provider: "Google", inputPrice: 1.25, outputPrice: 10.0, contextK: 1000, tags: ["reasoning", "vision", "long-ctx"] },
  { id: "kimi-k2-0905", name: "Kimi K2 0905", provider: "Moonshot", inputPrice: 0.6, outputPrice: 2.5, contextK: 256, tags: ["agentic", "tools", "coding"] },
  { id: "deepseek-v3.2", name: "DeepSeek V3.2", provider: "DeepSeek", inputPrice: 0.28, outputPrice: 0.42, contextK: 128, tags: ["coding", "budget"] },
  { id: "qwen3-coder-480b", name: "Qwen3 Coder 480B", provider: "Alibaba", inputPrice: 0.4, outputPrice: 1.6, contextK: 256, tags: ["coding", "agentic", "open"] },
  { id: "glm-4.6", name: "GLM-4.6", provider: "Zhipu", inputPrice: 0.5, outputPrice: 1.8, contextK: 200, tags: ["coding", "tools"] },
  { id: "grok-4-fast", name: "Grok 4 Fast", provider: "xAI", inputPrice: 0.2, outputPrice: 0.5, contextK: 2000, tags: ["budget", "long-ctx"] },
  { id: "gpt-4.1-nano", name: "GPT-4.1 Nano", provider: "OpenAI", inputPrice: 0.1, outputPrice: 0.4, contextK: 1000, tags: ["budget", "fast"] },
  { id: "llama-4-maverick", name: "Llama 4 Maverick", provider: "Meta", inputPrice: 0.22, outputPrice: 0.85, contextK: 1000, tags: ["open", "budget"] },
  { id: "mistral-large-3", name: "Mistral Large 3", provider: "Mistral", inputPrice: 0.5, outputPrice: 1.5, contextK: 256, tags: ["coding", "open"] },
  { id: "minimax-m2", name: "MiniMax M2", provider: "MiniMax", inputPrice: 0.3, outputPrice: 1.2, contextK: 200, tags: ["agentic", "budget"] },
];

export const AGENT_SYSTEM_PROMPT = `You are NanoForge, an autonomous coding agent. You read the user's request, plan concrete edits, and respond with precise, minimal code changes. Explain briefly, act decisively.

When changing code, emit one \`\`\`diff fence whose first line is \`--- file: <path>\`. Inside the fence, prefix every line with exactly one character: a space for unchanged context, \`-\` for removed lines, \`+\` for added lines. Together the context and removed lines must reconstruct the file's current content, and the context and added lines the new content — the patch is applied mechanically. Emit at most one diff fence per reply; if you need to react to a verification request, reply \`LGTM\` when the applied change is correct, or emit a single follow-up \`\`\`diff fence when it needs fixing.`;

export const VIRTUAL_PROJECT: VirtualFile[] = [
  {
    path: "src/server.ts",
    language: "typescript",
    content: `import http from "node:http";

const PORT = Number(process.env.PORT ?? 8080);

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

server.listen(PORT, () => {
  console.log(\`listening on :\${PORT}\`);
});
`,
  },
  {
    path: "src/rate-limit.ts",
    language: "typescript",
    content: `interface Bucket {
  tokens: number;
  updatedAt: number;
}

const buckets = new Map<string, Bucket>();

export function allow(key: string, limit = 60, perMs = 60_000): boolean {
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: limit, updatedAt: now };
  const elapsed = now - b.updatedAt;
  b.tokens = Math.min(limit, b.tokens + (elapsed / perMs) * limit);
  b.updatedAt = now;
  if (b.tokens < 1) {
    buckets.set(key, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(key, b);
  return true;
}
`,
  },
  {
    path: "package.json",
    language: "json",
    content: `{
  "name": "edge-api",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "test": "vitest run"
  }
}
`,
  },
  {
    path: "README.md",
    language: "markdown",
    content: `# edge-api

Tiny HTTP edge service. \`GET /health\` returns liveness.

## Run

\`\`\`bash
npm run dev
\`\`\`
`,
  },
];
