/**
 * Minimal Ollama HTTP client. Uses the global fetch (Node ≥ 20) and takes an
 * optional fetch implementation so tests never touch the network.
 */

export const DEFAULT_OLLAMA_URL = "http://localhost:11434";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface PullEvent {
  status: string;
  digest?: string;
  total?: number;
  completed?: number;
  error?: string;
}

export interface WarmupResult {
  tokensPerSec: number | null;
  evalCount: number;
  evalDurationMs: number;
  loadDurationMs: number;
  totalDurationMs: number;
  reply: string;
}

/** Stored in runtime/config.json so the runner can estimate packet time. */
export interface Benchmark {
  model: string;
  prompt_tps: number | null;
  gen_tps: number | null;
  prompt_tokens: number;
  load_ms: number;
  measured_at: string;
}

/** A typical packet: ~4k tokens in, ~2k tokens (one full file) out. */
export const TYPICAL_PACKET = { promptTokens: 4000, outputTokens: 2000 };

export function estimateSecondsPerPacket(b: Benchmark | null | undefined): number | null {
  if (!b?.prompt_tps || !b?.gen_tps) return null;
  return Math.round(
    TYPICAL_PACKET.promptTokens / b.prompt_tps + TYPICAL_PACKET.outputTokens / b.gen_tps,
  );
}

/** ~2k tokens of code-like text with a nonce so Ollama cannot reuse a cached prefix. */
export function benchmarkPrompt(nonce: number = Date.now()): string {
  const unit = `// nonce ${nonce}
export function process${nonce % 97}(items: readonly Item[], opts: Options = {}): Result {
  const out: Result = { kept: [], dropped: [], total: 0 };
  for (const item of items) {
    if (item.score < (opts.threshold ?? 0.5)) { out.dropped.push(item.id); continue; }
    out.kept.push({ ...item, tags: [...new Set(item.tags)].sort() });
    out.total += item.score;
  }
  return out;
}
`;
  let text = "";
  while (text.length < 7200) text += unit;
  return `${text}\nRead the code above. Reply with the single word OK.`;
}

export interface LocalModel {
  name: string;
  sizeBytes: number;
}

export class OllamaClient {
  readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(baseUrl: string = DEFAULT_OLLAMA_URL, fetchImpl: FetchLike = (i, o) => fetch(i, o)) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetchImpl = fetchImpl;
  }

  /** Server version, or null when unreachable. Never throws. */
  async version(timeoutMs = 3000): Promise<string | null> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/api/version`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { version?: string };
      return data.version ?? null;
    } catch {
      return null;
    }
  }

  async isUp(timeoutMs = 3000): Promise<boolean> {
    return (await this.version(timeoutMs)) !== null;
  }

  /** Models present locally. Throws when the server is unreachable. */
  async list(): Promise<LocalModel[]> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`Ollama /api/tags returned HTTP ${res.status}`);
    const data = (await res.json()) as { models?: { name: string; size?: number }[] };
    return (data.models ?? []).map((m) => ({ name: m.name, sizeBytes: m.size ?? 0 }));
  }

  async hasModel(tag: string): Promise<boolean> {
    const models = await this.list();
    return models.some((m) => m.name === tag || m.name === `${tag}:latest`);
  }

  /**
   * Pull a model with streaming progress. Calls `onEvent` for every NDJSON line.
   * Resolves when the stream ends with a success status; rejects on error.
   */
  async pull(tag: string, onEvent: (e: PullEvent) => void, signal?: AbortSignal): Promise<void> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: tag, stream: true }),
      ...(signal ? { signal } : {}),
    });
    if (!res.ok || !res.body) {
      throw new Error(`Ollama /api/pull failed: HTTP ${res.status} ${await safeText(res)}`);
    }
    let sawSuccess = false;
    for await (const event of ndjson(res.body)) {
      const e = event as PullEvent;
      if (e.error) throw new Error(`Ollama pull error: ${e.error}`);
      onEvent(e);
      if (e.status === "success") sawSuccess = true;
    }
    if (!sawSuccess) throw new Error("Ollama pull stream ended without a success status");
  }

  /** One short generation to load the model and measure throughput. */
  async warmup(tag: string, keepAlive = "30m", timeoutMs = 180_000): Promise<WarmupResult> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: tag,
        prompt:
          "Write a JavaScript one-liner that returns the sum of an array. Reply with code only.",
        stream: false,
        keep_alive: keepAlive,
        options: { num_predict: 64, temperature: 0 },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok)
      throw new Error(`Ollama /api/generate failed: HTTP ${res.status} ${await safeText(res)}`);
    const data = (await res.json()) as {
      response?: string;
      eval_count?: number;
      eval_duration?: number;
      load_duration?: number;
      total_duration?: number;
    };
    const evalCount = data.eval_count ?? 0;
    const evalNs = data.eval_duration ?? 0;
    return {
      tokensPerSec: evalNs > 0 ? Math.round((evalCount / (evalNs / 1e9)) * 10) / 10 : null,
      evalCount,
      evalDurationMs: Math.round(evalNs / 1e6),
      loadDurationMs: Math.round((data.load_duration ?? 0) / 1e6),
      totalDurationMs: Math.round((data.total_duration ?? 0) / 1e6),
      reply: data.response ?? "",
    };
  }

  /**
   * Measure prompt-processing and generation speed with a ~2k-token prompt.
   * Loads the model as a side effect (keep_alive keeps it resident).
   */
  async benchmark(
    tag: string,
    opts: { numCtx?: number; keepAlive?: string; timeoutMs?: number } = {},
  ): Promise<Benchmark> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: tag,
        prompt: benchmarkPrompt(),
        stream: false,
        keep_alive: opts.keepAlive ?? "30m",
        options: { num_predict: 96, temperature: 0, num_ctx: opts.numCtx ?? 16384 },
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 300_000),
    });
    if (!res.ok)
      throw new Error(`Ollama /api/generate failed: HTTP ${res.status} ${await safeText(res)}`);
    const d = (await res.json()) as {
      prompt_eval_count?: number;
      prompt_eval_duration?: number;
      eval_count?: number;
      eval_duration?: number;
      load_duration?: number;
    };
    const pt = d.prompt_eval_count ?? 0;
    const pd = (d.prompt_eval_duration ?? 0) / 1e9;
    const gt = d.eval_count ?? 0;
    const gd = (d.eval_duration ?? 0) / 1e9;
    return {
      model: tag,
      prompt_tps: pd > 0 ? Math.round(pt / pd) : null,
      gen_tps: gd > 0 ? Math.round((gt / gd) * 10) / 10 : null,
      prompt_tokens: pt,
      load_ms: Math.round((d.load_duration ?? 0) / 1e6),
      measured_at: new Date().toISOString(),
    };
  }

  /** Poll until the server answers or the deadline passes. */
  async waitUntilUp(timeoutMs = 30_000, intervalMs = 500): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.isUp(1500)) return true;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return false;
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "";
  }
}

/** Parse a newline-delimited JSON stream. */
export async function* ndjson(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl = buffer.indexOf("\n");
    while (nl >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) yield JSON.parse(line);
      nl = buffer.indexOf("\n");
    }
  }
  const rest = buffer.trim();
  if (rest) yield JSON.parse(rest);
}
