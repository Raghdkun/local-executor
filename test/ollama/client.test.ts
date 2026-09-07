import { describe, expect, it, vi } from "vitest";
import { estimateSecondsPerPacket, ndjson, OllamaClient } from "../../src/ollama/client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function streamResponse(lines: unknown[]): Response {
  const text = lines.map((l) => JSON.stringify(l)).join("\n");
  return new Response(text, { status: 200 });
}

describe("OllamaClient", () => {
  it("normalizes the base URL", () => {
    expect(new OllamaClient("http://x:1/").baseUrl).toBe("http://x:1");
  });

  it("version() returns null when unreachable and never throws", async () => {
    const c = new OllamaClient("http://localhost:1", async () => {
      throw new Error("ECONNREFUSED");
    });
    expect(await c.version()).toBeNull();
    expect(await c.isUp()).toBe(false);
  });

  it("version() parses the server response", async () => {
    const c = new OllamaClient("http://x", async () => jsonResponse({ version: "0.33.3" }));
    expect(await c.version()).toBe("0.33.3");
  });

  it("list() and hasModel() read /api/tags", async () => {
    const fetchImpl = vi.fn(async (_url: string) =>
      jsonResponse({
        models: [{ name: "qwen3.5:9b", size: 7_000_000_000 }, { name: "other:latest" }],
      }),
    );
    const c = new OllamaClient("http://x", fetchImpl);
    expect(await c.list()).toEqual([
      { name: "qwen3.5:9b", sizeBytes: 7_000_000_000 },
      { name: "other:latest", sizeBytes: 0 },
    ]);
    expect(await c.hasModel("qwen3.5:9b")).toBe(true);
    expect(await c.hasModel("other")).toBe(true);
    expect(await c.hasModel("missing")).toBe(false);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("http://x/api/tags");
  });

  it("pull() streams events and resolves on success", async () => {
    const events: string[] = [];
    const c = new OllamaClient("http://x", async () =>
      streamResponse([
        { status: "pulling manifest" },
        { status: "pulling abc", digest: "abc", total: 100, completed: 50 },
        { status: "pulling abc", digest: "abc", total: 100, completed: 100 },
        { status: "verifying sha256 digest" },
        { status: "success" },
      ]),
    );
    await c.pull("qwen3.5:9b", (e) => events.push(e.status));
    expect(events).toEqual([
      "pulling manifest",
      "pulling abc",
      "pulling abc",
      "verifying sha256 digest",
      "success",
    ]);
  });

  it("pull() rejects on an error event", async () => {
    const c = new OllamaClient("http://x", async () =>
      streamResponse([{ error: "pull model manifest: file does not exist" }]),
    );
    await expect(c.pull("nope:1b", () => undefined)).rejects.toThrow(/does not exist/);
  });

  it("pull() rejects when the stream ends without success", async () => {
    const c = new OllamaClient("http://x", async () =>
      streamResponse([{ status: "pulling manifest" }]),
    );
    await expect(c.pull("x", () => undefined)).rejects.toThrow(/without a success/);
  });

  it("pull() rejects on HTTP error", async () => {
    const c = new OllamaClient("http://x", async () => new Response("boom", { status: 500 }));
    await expect(c.pull("x", () => undefined)).rejects.toThrow(/HTTP 500/);
  });

  it("warmup() computes tokens per second from eval_count / eval_duration", async () => {
    const c = new OllamaClient("http://x", async () =>
      jsonResponse({
        response: "ok",
        eval_count: 50,
        eval_duration: 2_000_000_000,
        load_duration: 500_000_000,
        total_duration: 3_000_000_000,
      }),
    );
    const w = await c.warmup("qwen3.5:9b");
    expect(w.tokensPerSec).toBe(25);
    expect(w.loadDurationMs).toBe(500);
    expect(w.totalDurationMs).toBe(3000);
  });

  it("warmup() reports null tok/s when eval_duration is missing", async () => {
    const c = new OllamaClient("http://x", async () => jsonResponse({ response: "ok" }));
    expect((await c.warmup("m")).tokensPerSec).toBeNull();
  });

  it("waitUntilUp() polls until the server answers", async () => {
    let calls = 0;
    const c = new OllamaClient("http://x", async () => {
      calls++;
      if (calls < 3) throw new Error("down");
      return jsonResponse({ version: "1" });
    });
    expect(await c.waitUntilUp(5000, 1)).toBe(true);
    expect(calls).toBe(3);
  });
});

describe("ndjson", () => {
  it("handles chunk boundaries inside a line and a trailing line without newline", async () => {
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(ctrl) {
        ctrl.enqueue(enc.encode('{"a":1}\n{"b"'));
        ctrl.enqueue(enc.encode(':2}\n\n{"c":3}'));
        ctrl.close();
      },
    });
    const out: unknown[] = [];
    for await (const x of ndjson(body)) out.push(x);
    expect(out).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });
});

describe("benchmark", () => {
  it("computes prompt and generation tok/s from the generate response", async () => {
    let sentPrompt = "";
    const c = new OllamaClient("http://x", async (_url: string, init?: RequestInit) => {
      sentPrompt = (JSON.parse(String(init?.body)) as { prompt: string }).prompt;
      return jsonResponse({
        prompt_eval_count: 2000,
        prompt_eval_duration: 5_000_000_000,
        eval_count: 80,
        eval_duration: 5_000_000_000,
        load_duration: 1_500_000_000,
      });
    });
    const b = await c.benchmark("qwen3.5:9b");
    expect(b).toMatchObject({
      model: "qwen3.5:9b",
      prompt_tps: 400,
      gen_tps: 16,
      prompt_tokens: 2000,
      load_ms: 1500,
    });
    expect(sentPrompt.length).toBeGreaterThan(7000);
    expect(estimateSecondsPerPacket(b)).toBe(135);
    expect(estimateSecondsPerPacket({ ...b, gen_tps: null })).toBeNull();
  });
});
