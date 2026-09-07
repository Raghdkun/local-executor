#!/usr/bin/env node
/**
 * Reports whether Ollama is running and has the configured model, and how long
 * a packet will take. Works on macOS, Linux, Windows.
 *
 * Usage: node check_local.mjs [--json] [--bench]
 *
 *   default  fast check (/api/tags) plus the time estimate from the last benchmark
 *   --bench  send a ~2k-token prompt to measure prompt tok/s and generation
 *            tok/s for the configured model, store them in config.json, and
 *            print the estimate. Takes 30–90 s. Run it once per model.
 *
 * Exit 0 = ready. Exit 1 = something missing (message says what).
 */
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const configPath = join(here, "config.json");
const json = process.argv.includes("--json");
const bench = process.argv.includes("--bench");

/** A typical packet: ~4k tokens in, ~2k tokens (one full file) out. */
export const TYPICAL_PACKET = { promptTokens: 4000, outputTokens: 2000 };

export function estimateFromBenchmark(b, p = TYPICAL_PACKET) {
  if (!b?.prompt_tps || !b?.gen_tps) return null;
  return Math.round(p.promptTokens / b.prompt_tps + p.outputTokens / b.gen_tps);
}

export function formatDuration(seconds) {
  if (seconds < 90) return `${seconds} s`;
  return `${Math.round(seconds / 60)} min`;
}

/** ~2k tokens of code-like text with a nonce so Ollama cannot reuse a cached prefix. */
export function benchmarkPrompt(nonce = Date.now()) {
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

export function authHeaders(config, env = process.env) {
  const token =
    config.ollama_token || (config.ollama_token_env ? env[config.ollama_token_env] : undefined);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function report(status, message, extra = {}) {
  if (json) console.log(JSON.stringify({ status, message, config: configPath, ...extra }));
  else console.log(`${status}: ${message}`);
}

async function runBenchmark(config) {
  const res = await fetch(`${config.ollama_url}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(config) },
    body: JSON.stringify({
      model: config.model,
      prompt: benchmarkPrompt(),
      stream: false,
      keep_alive: config.keep_alive ?? "30m",
      options: { num_predict: 96, temperature: 0, num_ctx: config.num_ctx ?? 16384 },
    }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const d = await res.json();
  const pt = d.prompt_eval_count ?? 0;
  const pd = (d.prompt_eval_duration ?? 0) / 1e9;
  const gt = d.eval_count ?? 0;
  const gd = (d.eval_duration ?? 0) / 1e9;
  return {
    model: config.model,
    prompt_tps: pd > 0 ? Math.round(pt / pd) : null,
    gen_tps: gd > 0 ? Math.round((gt / gd) * 10) / 10 : null,
    prompt_tokens: pt,
    load_ms: Math.round((d.load_duration ?? 0) / 1e6),
    measured_at: new Date().toISOString(),
  };
}

async function main() {
  let config;
  try {
    config = JSON.parse(await readFile(configPath, "utf8"));
  } catch (err) {
    report(
      "BROKEN CONFIG",
      `cannot read ${configPath}: ${err.message}. Re-run: npx local-executor`,
    );
    return 1;
  }

  let tags;
  try {
    const res = await fetch(`${config.ollama_url}/api/tags`, {
      signal: AbortSignal.timeout(3000),
      headers: authHeaders(config),
    });
    if (res.status === 401 || res.status === 403) {
      report(
        "AUTH",
        `${config.ollama_url} rejected the request (HTTP ${res.status}). Set ollama_token or ollama_token_env in config.json.`,
        { model: config.model },
      );
      return 1;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    tags = await res.json();
  } catch {
    report(
      "NOT RUNNING",
      `ollama server not reachable at ${config.ollama_url}. Start it (open the Ollama app, or run: ollama serve) or install it: npx local-executor`,
      { model: config.model },
    );
    return 1;
  }

  const names = (tags.models ?? []).map((m) => m.name);
  const have = names.includes(config.model) || names.includes(`${config.model}:latest`);
  if (!have) {
    report("MISSING MODEL", `${config.model} not pulled. Run: ollama pull ${config.model}`, {
      model: config.model,
      available: names,
    });
    return 1;
  }

  let benchmark =
    config.benchmark && config.benchmark.model === config.model ? config.benchmark : null;
  if (bench) {
    if (!json) console.log(`Benchmarking ${config.model} with a ~2k-token prompt (30–90 s)…`);
    try {
      benchmark = await runBenchmark(config);
      config.benchmark = benchmark;
      await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
    } catch (err) {
      report(
        "BENCH FAILED",
        `${config.model} is present but the benchmark request failed: ${err.message}. Check memory pressure and \`ollama ps\`.`,
        { model: config.model },
      );
      return 1;
    }
  }

  // Has anyone checked ollama.com for newer models recently? (lex models --refresh)
  let freshness =
    "Newer-model check: never run — run `npx local-executor@latest models --refresh` (network, changes nothing).";
  try {
    const stamp = JSON.parse(
      await readFile(
        join(process.env.LEX_HOME ?? join(homedir(), ".local-executor"), "cache", "refresh.json"),
        "utf8",
      ),
    );
    const days = Math.floor((Date.now() - new Date(stamp.checkedAt).getTime()) / 86_400_000);
    freshness =
      days > 14
        ? `Newer-model check: ${days} days ago (stale) — run \`npx local-executor@latest models --refresh\`.`
        : `Newer-model check: ${days} days ago.`;
  } catch {
    // no stamp yet
  }

  const eta = estimateFromBenchmark(benchmark);
  const estimate =
    eta === null
      ? "Time per packet: unmeasured — run `check_local.mjs --bench` once (30–90 s) to get an estimate."
      : `Expect about ${formatDuration(eta)} per typical packet (${TYPICAL_PACKET.promptTokens} tokens in, ${TYPICAL_PACKET.outputTokens} out) at ${benchmark.prompt_tps} prompt tok/s and ${benchmark.gen_tps} gen tok/s. Run packets in the background, one at a time.`;
  const sizes = Object.fromEntries(
    (tags.models ?? []).map((m) => [m.name, Math.round(((m.size ?? 0) / 1024 ** 3) * 10) / 10]),
  );
  const fallback =
    config.fallback_model &&
    (names.includes(config.fallback_model) || names.includes(`${config.fallback_model}:latest`))
      ? config.fallback_model
      : null;
  const models = `Default model ${config.model}; fallback ${config.fallback_model ?? "none"}${fallback ? " (pulled)" : " (not pulled)"}; pulled: ${names.map((n) => `${n} (${sizes[n]} GB)`).join(", ")}.`;
  report(
    "READY",
    `ollama running at ${config.ollama_url} with model ${config.model}. ${estimate} ${models} ${freshness}`,
    {
      model: config.model,
      fallback_model: config.fallback_model ?? null,
      fallback_pulled: fallback !== null,
      available: names,
      sizesGB: sizes,
      benchmark,
      estimatedSecondsPerPacket: eta,
      freshness,
    },
  );
  return 0;
}

if (
  process.argv[1] &&
  (await import("node:path")).resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exit(await main());
}
