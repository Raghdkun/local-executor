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
