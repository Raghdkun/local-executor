#!/usr/bin/env node
/**
 * Send a task packet to the local Ollama model and collect the code it returns.
 *
 * Usage:
 *   node run_executor.mjs --packet packet.md --out response.md [--apply] [--root .] [--model TAG] [--json]
 *
 * The executor is told (via ../core/executor-system-prompt.md) to answer ONLY
 * with fenced code blocks whose info string names the target file:
 *
 *     ```python path=src/utils.py
 *     ...
 *     ```
 *
 * With --apply, each block is written under --root (a .bak copy is made first).
 * Without --apply, blocks are only saved to --out for the planner to inspect.
 *
 * Exit codes:
 *   0 ok           2 Ollama/network error      3 no code blocks returned
 *   1 usage        4 executor declared it cannot do the task (EXECUTOR_CANNOT.md)
 */
import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(await readFile(join(here, "config.json"), "utf8"));
const systemPrompt = await readFile(join(here, "..", "core", "executor-system-prompt.md"), "utf8");

const BLOCK_RE = /```([\w+#.-]*)[ \t]+path=(\S+)[ \t]*\r?\n([\s\S]*?)\r?\n?```/g;
const CANNOT_FILE = "EXECUTOR_CANNOT.md";

function usage(code) {
  console.error(
    "usage: run_executor.mjs --packet <file> --out <file> [--apply] [--root <dir>] [--model <tag>] [--json]",
  );
  process.exit(code);
}

function parseArgs(argv) {
  const args = { apply: false, root: ".", model: config.model, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") args.apply = true;
    else if (a === "--json") args.json = true;
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
  if (!args.packet || !args.out) usage(1);
  return args;
}

async function callOllama(model, packet) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), (config.timeout_seconds ?? 600) * 1000);
  try {
    const res = await fetch(`${config.ollama_url}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        stream: false,
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
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    return {
      content: data.message?.content ?? "",
      evalCount: data.eval_count ?? 0,
      evalDurationMs: Math.round((data.eval_duration ?? 0) / 1e6),
      promptEvalCount: data.prompt_eval_count ?? 0,
    };
  } finally {
    clearTimeout(timer);
  }
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

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const packet = await readFile(args.packet, "utf8");

  let result;
  try {
    result = await callOllama(args.model, packet);
  } catch (err) {
    console.error(`EXECUTOR ERROR: ${err.message}`);
    console.error(
      `Is Ollama running at ${config.ollama_url}? Try: node "${join(here, "check_local.mjs")}"`,
    );
    return 2;
  }

  const response = stripThinking(result.content);
  await mkdir(dirname(resolve(args.out)), { recursive: true });
  await writeFile(args.out, response);

  const blocks = parseBlocks(response);
  const tps =
    result.evalDurationMs > 0
      ? Math.round((result.evalCount / (result.evalDurationMs / 1000)) * 10) / 10
      : null;

  if (blocks.length === 0) {
    console.error(`EXECUTOR RETURNED NO CODE BLOCKS — see ${args.out}`);
    if (args.json)
      console.log(JSON.stringify({ ok: false, reason: "no_blocks", files: [], tokensPerSec: tps }));
    return 3;
  }

  const cannot = blocks.find((b) => b.path === CANNOT_FILE);
  if (cannot) {
    console.error("EXECUTOR CANNOT DO THIS TASK:");
    console.error(cannot.code.trim());
    if (args.json)
      console.log(
        JSON.stringify({
          ok: false,
          reason: "cannot",
          message: cannot.code.trim(),
          tokensPerSec: tps,
        }),
      );
    return 4;
  }

  const written = [];
  if (args.apply) {
    for (const b of blocks) {
      let target;
      try {
        target = safeTarget(args.root, b.path);
      } catch (err) {
        console.error(`SKIPPED: ${err.message}`);
        continue;
      }
      await mkdir(dirname(target), { recursive: true });
      if (await exists(target)) await copyFile(target, `${target}.bak`);
      await writeFile(target, b.code);
      written.push(target);
    }
  }

  if (args.json) {
    console.log(
      JSON.stringify({
        ok: true,
        files: blocks.map((b) => b.path),
        written,
        model: args.model,
        evalCount: result.evalCount,
        promptEvalCount: result.promptEvalCount,
        tokensPerSec: tps,
      }),
    );
  } else {
    console.log(
      `Executor (${args.model}) returned ${blocks.length} file(s)${tps ? ` at ${tps} tok/s` : ""}:`,
    );
    for (const b of blocks) console.log(`  - ${b.path}`);
    for (const t of written) console.log(`  wrote ${t}`);
    if (!args.apply) console.log(`Not applied (no --apply). Raw response: ${args.out}`);
  }
  return 0;
}

// Only run when executed directly, so tests can import the pure helpers.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(await main());
}
