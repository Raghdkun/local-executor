#!/usr/bin/env node
/**
 * Send a task packet to the local Ollama model and collect the code it returns.
 *
 * Usage:
 *   node run_executor.mjs --packet packet.md --out response.md
 *        [--apply] [--root .] [--model TAG] [--json] [--wait] [--dry-run] [--allow-unchanged]
 *
 * The executor is told (via ../core/executor-system-prompt.md) to answer ONLY
 * with fenced code blocks whose info string names the target file:
 *
 *     ```python path=src/utils.py
 *     ...
 *     ```
 *
 * Behaviour that matters when a packet takes minutes:
 *   - The request is streamed, so nothing times out while the model generates;
 *     progress (tokens, elapsed) is printed to stderr every 10 s.
 *   - Only one executor runs per Ollama server at a time (lock file). A second
 *     invocation exits 5 with "executor busy"; pass --wait to queue instead.
 *   - Before sending, the prompt and the expected full-file output are estimated
 *     against num_ctx and a warning is printed when they are close. --dry-run
 *     prints those estimates and the time estimate (from a benchmark) and exits.
 *   - Returned files are diffed against the files on disk under --root. If every
 *     block is byte-identical to what exists, that is never a valid result:
 *     exit 6 (unless --allow-unchanged).
 *   - With --apply, files are written under --root; backups go to
 *     <root>/.lex/backups/<timestamp>/ (never next to the sources) and
 *     <root>/.lex/.gitignore keeps that directory out of git.
 *
 * Exit codes:
 *   0 ok               3 no code blocks returned          6 executor returned files unchanged
 *   1 usage            4 executor declared it cannot (EXECUTOR_CANNOT.md)
 *   2 Ollama/network   5 executor busy (another run in progress)
 */
import { createHash } from "node:crypto";
import { access, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const CANNOT_FILE = "EXECUTOR_CANNOT.md";
const BLOCK_RE = /```([\w+#.-]*)[ \t]+path=(\S+)[ \t]*\r?\n([\s\S]*?)\r?\n?```/g;
/** Rough chars-per-token for code and English mixed; errs on the high side. */
const CHARS_PER_TOKEN = 3.6;
const PROGRESS_EVERY_MS = 10_000;

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

export function estimateTokens(text) {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Strip any <think>…</think> reasoning a model might emit despite think:false. */
export function stripThinking(text) {
  return text.replace(/<think>[\s\S]*?<\/think>\s*/g, "");
}

export function parseBlocks(text) {
  return [...text.matchAll(BLOCK_RE)].map((m) => ({
    lang: m[1] || "",
    path: m[2],
    code: m[3].endsWith("\n") ? m[3] : `${m[3]}\n`,
  }));
}

/** Refuse absolute paths and anything that escapes the root. Returns the resolved target. */
export function safeTarget(root, relPath) {
  const cleaned = normalize(relPath).replace(/^[\\/]+/, "");
  if (isAbsolute(relPath) || /^[a-zA-Z]:/.test(relPath)) {
    throw new Error(`refusing absolute path from executor: ${relPath}`);
  }
  const target = resolve(root, cleaned);
  const rel = relative(resolve(root), target);
  if (rel.startsWith("..") || rel.split(sep).includes("..")) {
    throw new Error(`refusing path outside root: ${relPath}`);
  }
  return target;
}

/**
 * The executor returns complete files, so the expected output is about the
 * size of the code pasted under "## Existing code" (plus a margin for new
 * code). Falls back to a flat guess when the packet has no such section.
 */
export function expectedOutputTokens(packet) {
  const m = /^## Existing code[^\n]*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m.exec(packet);
  const section = m ? m[1] : "";
  let chars = 0;
  for (const b of section.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) chars += b[1].length;
  if (chars === 0) return 1500;
  return Math.ceil(estimateTokens(section.slice(0, 0) + "x".repeat(chars)) * 1.2);
}

export function checkBudget({ promptTokens, expectedOutput, numCtx }) {
  const total = promptTokens + expectedOutput;
  const ratio = total / numCtx;
  if (ratio > 1) {
    return {
      level: "error",
      total,
      message: `Estimated ${promptTokens} prompt + ${expectedOutput} output tokens = ${total}, over num_ctx ${numCtx}. The reply will be truncated. Split the packet or raise num_ctx in config.json.`,
    };
  }
  if (ratio > 0.85) {
    return {
      level: "warn",
      total,
      message: `Estimated ${promptTokens} prompt + ${expectedOutput} output tokens = ${total}, ${Math.round(ratio * 100)}% of num_ctx ${numCtx}. Close to the limit; a slightly larger file would truncate.`,
    };
  }
  return {
    level: "ok",
    total,
    message: `Estimated ${promptTokens} prompt + ${expectedOutput} output tokens = ${total} of num_ctx ${numCtx}.`,
  };
}

/** Seconds a packet is expected to take, from a stored benchmark. Null when unmeasured. */
export function estimateSeconds(benchmark, promptTokens, expectedOutput) {
  if (!benchmark?.prompt_tps || !benchmark?.gen_tps) return null;
  return Math.round(promptTokens / benchmark.prompt_tps + expectedOutput / benchmark.gen_tps);
}

export function formatDuration(seconds) {
  if (seconds < 90) return `${seconds} s`;
  return `${Math.round(seconds / 60)} min`;
}

export function lockPath(ollamaUrl) {
  const h = createHash("sha1").update(ollamaUrl).digest("hex").slice(0, 10);
  return join(tmpdir(), `lex-executor-${h}.lock`);
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

/**
 * Take the executor lock. Returns { acquired: true } or, when another run is
 * in progress and wait is false, { acquired: false, holder }.
 */
export async function acquireLock(
  path,
  { wait = false, pollMs = 5000, now = () => Date.now() } = {},
) {
  for (;;) {
    try {
      await writeFile(
        path,
        JSON.stringify({ pid: process.pid, since: new Date(now()).toISOString() }),
        { flag: "wx" },
      );
      return { acquired: true };
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
    }
    let holder = null;
    try {
      holder = JSON.parse(await readFile(path, "utf8"));
    } catch {
      holder = null;
    }
    if (!holder || !pidAlive(holder.pid)) {
      await rm(path, { force: true });
      continue; // stale lock removed; try again
    }
    if (!wait) return { acquired: false, holder };
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

export async function releaseLock(path) {
  await rm(path, { force: true });
}

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Classify returned blocks against what is on disk under root. */
export async function compareWithExisting(root, blocks) {
  const result = { unchanged: [], changed: [], created: [], rejected: [] };
  for (const b of blocks) {
    let target;
    try {
      target = safeTarget(root, b.path);
    } catch (err) {
      result.rejected.push({ path: b.path, reason: err.message });
      continue;
    }
    if (!(await exists(target))) {
      result.created.push(b.path);
      continue;
    }
    const current = await readFile(target, "utf8");
    if (current === b.code || current.replace(/\r\n/g, "\n") === b.code.replace(/\r\n/g, "\n"))
      result.unchanged.push(b.path);
    else result.changed.push(b.path);
  }
  return result;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usage(code) {
  console.error(
    "usage: run_executor.mjs --packet <file> --out <file> [--apply] [--root <dir>] [--model <tag>] [--json] [--wait] [--dry-run] [--allow-unchanged]",
  );
  process.exit(code);
}

function parseArgs(argv, config) {
  const args = {
    apply: false,
    root: ".",
    model: config.model,
    json: false,
    wait: false,
    dryRun: false,
    allowUnchanged: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") args.apply = true;
    else if (a === "--json") args.json = true;
    else if (a === "--wait") args.wait = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--allow-unchanged") args.allowUnchanged = true;
    else if (a === "--packet") args.packet = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--root") args.root = argv[++i];
    else if (a === "--model") args.model = argv[++i];
    else if (a === "-h" || a === "--help") usage(0);
    else {
      console.error(`unknown argument: ${a}`);
      usage(1);
    }
  }
  if (!args.packet || (!args.out && !args.dryRun)) usage(1);
  return args;
}

/**
 * Streamed /api/chat call. Headers arrive immediately and chunks keep the
 * socket alive, so a 10-minute generation does not trip undici's timeouts.
 */
async function callOllama(config, model, systemPrompt, packet, onProgress) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), (config.timeout_seconds ?? 600) * 1000);
  try {
    const res = await fetch(`${config.ollama_url}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        stream: true,
        keep_alive: config.keep_alive ?? "30m",
        // Qwen 3.x and Gemma 4 support a "thinking" mode. Off by default: the
        // executor should spend its tokens on code, not deliberation.
        think: config.think ?? false,
        options: {
          temperature: config.temperature ?? 0.1,
          num_ctx: config.num_ctx ?? 16384,
        },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: packet },
        ],
      }),
    });
    if (!res.ok || !res.body)
      throw new Error(`Ollama HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    let content = "";
    let tokens = 0;
    let final = {};
    let buffer = "";
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl = buffer.indexOf("\n");
      while (nl >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        nl = buffer.indexOf("\n");
        if (!line) continue;
        const chunk = JSON.parse(line);
        if (chunk.error) throw new Error(`Ollama error: ${chunk.error}`);
        const piece = chunk.message?.content ?? "";
        if (piece) {
          content += piece;
          tokens += 1;
          onProgress(tokens);
        }
        if (chunk.done) final = chunk;
      }
    }
    return {
      content,
      evalCount: final.eval_count ?? tokens,
      evalDurationMs: Math.round((final.eval_duration ?? 0) / 1e6),
      promptEvalCount: final.prompt_eval_count ?? 0,
      promptEvalDurationMs: Math.round((final.prompt_eval_duration ?? 0) / 1e6),
      doneReason: final.done_reason ?? "unknown",
    };
  } finally {
    clearTimeout(timer);
  }
}

function describeFetchError(err, config) {
  const code = err?.cause?.code ?? err?.code ?? err?.name ?? "";
  const parts = [`EXECUTOR ERROR: ${err.message}${code ? ` (${code})` : ""}`];
  if (code === "ECONNREFUSED")
    parts.push(
      `Ollama is not listening at ${config.ollama_url}. Start it (Ollama app, or: ollama serve).`,
    );
  else if (code === "AbortError" || err?.name === "AbortError")
    parts.push(
      `Gave up after timeout_seconds=${config.timeout_seconds ?? 600}. Raise it in config.json for very large packets, or split the packet.`,
    );
  else if (/UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT/.test(code))
    parts.push(
      "Node's fetch timed out waiting for Ollama. This runner streams to avoid that; if you see it, Ollama is not producing tokens (out of memory? model swapping?). Check `ollama ps` and memory pressure.",
    );
  else parts.push(`Check the server with: node "${join(here, "check_local.mjs")}"`);
  return parts.join("\n");
}

async function ensureLexIgnored(root) {
  const dir = join(root, ".lex");
  await mkdir(dir, { recursive: true });
  const gi = join(dir, ".gitignore");
  if (!(await exists(gi))) await writeFile(gi, "*\n");
  return dir;
}

async function main() {
  const configPath = join(here, "config.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const args = parseArgs(process.argv.slice(2), config);
  const systemPrompt = await readFile(
    join(here, "..", "core", "executor-system-prompt.md"),
    "utf8",
  );
  const packet = await readFile(args.packet, "utf8");
  const numCtx = config.num_ctx ?? 16384;
  const log = (m) => console.error(m);

  // Budget and time estimates (before touching the network).
  const promptTokens = estimateTokens(systemPrompt) + estimateTokens(packet) + 32;
  const expectedOutput = expectedOutputTokens(packet);
  const budget = checkBudget({ promptTokens, expectedOutput, numCtx });
  const bench = config.benchmark && config.benchmark.model === args.model ? config.benchmark : null;
  const eta = estimateSeconds(bench, promptTokens, expectedOutput);
  const etaLine =
    eta === null
      ? "Time estimate: unknown (run check_local.mjs --bench once to measure this model)."
      : `Time estimate: about ${formatDuration(eta)} (${bench.prompt_tps} prompt tok/s, ${bench.gen_tps} gen tok/s measured). Run this in the background and do not start a second packet.`;

  if (args.dryRun) {
    const lock = lockPath(config.ollama_url);
    let holder = null;
    try {
      holder = JSON.parse(await readFile(lock, "utf8"));
      if (!pidAlive(holder.pid)) holder = null;
    } catch {
      holder = null;
    }
    const out = {
      dryRun: true,
      model: args.model,
      promptTokens,
      expectedOutput,
      numCtx,
      budget: budget.level,
      budgetMessage: budget.message,
      estimatedSeconds: eta,
      busy: holder,
    };
    if (args.json) console.log(JSON.stringify(out));
    else {
      console.log(`Dry run for ${args.model}:`);
      console.log(`  ${budget.message}`);
      console.log(`  ${etaLine}`);
      console.log(
        `  Executor ${holder ? `BUSY (pid ${holder.pid} since ${holder.since})` : "idle"}.`,
      );
    }
    return budget.level === "error" ? 1 : 0;
  }

  if (budget.level === "error") {
    log(`BUDGET: ${budget.message}`);
    return 1;
  }
  if (budget.level === "warn") log(`BUDGET WARNING: ${budget.message}`);
  else log(budget.message);
  log(etaLine);

  // The requested model must be pulled; never pull implicitly.
  try {
    const res = await fetch(`${config.ollama_url}/api/tags`, { signal: AbortSignal.timeout(5000) });
    const names = ((await res.json()).models ?? []).map((m) => m.name);
    if (!names.includes(args.model) && !names.includes(`${args.model}:latest`)) {
      log(
        `MODEL NOT PULLED: ${args.model} is not on this machine (available: ${names.join(", ") || "none"}). Ask the user before pulling: ollama pull ${args.model}`,
      );
      if (args.json)
        console.log(
          JSON.stringify({
            ok: false,
            reason: "model_not_pulled",
            model: args.model,
            available: names,
          }),
        );
      return 2;
    }
  } catch (err) {
    log(describeFetchError(err, config));
    return 2;
  }

  // One executor per server.
  const lock = lockPath(config.ollama_url);
  const got = await acquireLock(lock, { wait: args.wait });
  if (!got.acquired) {
    log(
      `EXECUTOR BUSY: another run_executor (pid ${got.holder.pid}) has been running since ${got.holder.since}. Ollama serves one request at a time; wait for it, or re-run with --wait to queue.`,
    );
    if (args.json) console.log(JSON.stringify({ ok: false, reason: "busy", holder: got.holder }));
    return 5;
  }

  let result;
  const started = Date.now();
  try {
    let lastProgress = started;
    result = await callOllama(config, args.model, systemPrompt, packet, (tokens) => {
      const now = Date.now();
      if (now - lastProgress >= PROGRESS_EVERY_MS) {
        lastProgress = now;
        log(`  … ${tokens} tokens, ${Math.round((now - started) / 1000)} s elapsed`);
      }
    });
  } catch (err) {
    log(describeFetchError(err, config));
    return 2;
  } finally {
    await releaseLock(lock);
  }

  const response = stripThinking(result.content);
  await mkdir(dirname(resolve(args.out)), { recursive: true });
  await writeFile(args.out, response);

  const blocks = parseBlocks(response);
  const genTps =
    result.evalDurationMs > 0
      ? Math.round((result.evalCount / (result.evalDurationMs / 1000)) * 10) / 10
      : null;
  const elapsed = Math.round((Date.now() - started) / 1000);
  const stats = {
    model: args.model,
    evalCount: result.evalCount,
    promptEvalCount: result.promptEvalCount,
    tokensPerSec: genTps,
    elapsedSeconds: elapsed,
    doneReason: result.doneReason,
  };

  if (result.doneReason === "length")
    log(
      `WARNING: the model hit the context/output limit (done_reason=length). The last file is probably truncated. Split the packet or raise num_ctx.`,
    );

  if (blocks.length === 0) {
    log(`EXECUTOR RETURNED NO CODE BLOCKS — see ${args.out}`);
    if (args.json)
      console.log(JSON.stringify({ ok: false, reason: "no_blocks", files: [], ...stats }));
    return 3;
  }

  const cannot = blocks.find((b) => b.path === CANNOT_FILE);
  if (cannot) {
    log("EXECUTOR CANNOT DO THIS TASK:");
    log(cannot.code.trim());
    if (args.json)
      console.log(
        JSON.stringify({ ok: false, reason: "cannot", message: cannot.code.trim(), ...stats }),
      );
    return 4;
  }

  const cmp = await compareWithExisting(args.root, blocks);
  for (const r of cmp.rejected) log(`SKIPPED: ${r.reason}`);
  if (
    cmp.unchanged.length > 0 &&
    cmp.changed.length === 0 &&
    cmp.created.length === 0 &&
    !args.allowUnchanged
  ) {
    log(
      `EXECUTOR RETURNED FILES UNCHANGED: ${cmp.unchanged.join(", ")} are byte-identical to the files on disk. That is never a valid result; retry with a numbered "fix exactly these" list (see handoff-template.md).`,
    );
    if (args.json)
      console.log(
        JSON.stringify({ ok: false, reason: "unchanged", files: cmp.unchanged, ...stats }),
      );
    return 6;
  }
  for (const u of cmp.unchanged) log(`NOTE: ${u} came back unchanged.`);

  const written = [];
  if (args.apply) {
    const lexDir = await ensureLexIgnored(args.root);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupDir = join(lexDir, "backups", stamp);
    for (const b of blocks) {
      if (cmp.rejected.some((r) => r.path === b.path)) continue;
      const target = safeTarget(args.root, b.path);
      await mkdir(dirname(target), { recursive: true });
      if (await exists(target)) {
        const backup = join(backupDir, b.path);
        await mkdir(dirname(backup), { recursive: true });
        await copyFile(target, backup);
      }
      await writeFile(target, b.code);
      written.push(target);
    }
    if (written.length > 0) log(`Backups of overwritten files: ${backupDir}`);
  }

  if (args.json) {
    console.log(
      JSON.stringify({
        ok: true,
        files: blocks.map((b) => b.path),
        created: cmp.created,
        changed: cmp.changed,
        unchanged: cmp.unchanged,
        written,
        ...stats,
      }),
    );
  } else {
    console.log(
      `Executor (${args.model}) returned ${blocks.length} file(s) in ${formatDuration(elapsed)}${genTps ? ` at ${genTps} tok/s` : ""}:`,
    );
    for (const b of blocks) {
      const tag = cmp.created.includes(b.path)
        ? "new"
        : cmp.changed.includes(b.path)
          ? "changed"
          : cmp.unchanged.includes(b.path)
            ? "unchanged"
            : "rejected";
      console.log(`  - ${b.path} (${tag})`);
    }
    for (const t of written) console.log(`  wrote ${t}`);
    if (!args.apply) console.log(`Not applied (no --apply). Raw response: ${args.out}`);
  }
  return 0;
}

// Only run when executed directly, so tests can import the pure helpers.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(await main());
}
