#!/usr/bin/env node
/**
 * Send a task packet to the local Ollama model and collect the code it returns.
 *
 * Usage:
 *   node run_executor.mjs --packet packet.md --out response.md [--apply] [--root .] [--model NAME]
 *
 * The executor is told (via references/executor-system-prompt.md) to answer ONLY
 * with fenced code blocks whose info string is the target file path:
 *
 *     ```python path=src/utils.py
 *     ...
 *     ```
 *
 * With --apply, each block is written to that path (a .bak copy is made first).
 * Without --apply, blocks are only saved to --out for the planner to inspect.
 * Exit codes: 0 ok, 2 Ollama error, 3 no code blocks returned.
 */
import { readFile, writeFile, mkdir, copyFile, access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(await readFile(join(here, "config.json"), "utf8"));
const systemPrompt = await readFile(
  join(here, "..", "references", "executor-system-prompt.md"),
  "utf8",
);

const BLOCK_RE = /```(\w+)?\s+path=(\S+)\n([\s\S]*?)```/g;

function parseArgs(argv) {
  const args = { apply: false, root: ".", model: config.model };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") args.apply = true;
    else if (a === "--packet") args.packet = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--root") args.root = argv[++i];
    else if (a === "--model") args.model = argv[++i];
  }
  if (!args.packet || !args.out) {
    console.error("usage: run_executor.mjs --packet <file> --out <file> [--apply] [--root dir] [--model tag]");
    process.exit(1);
  }
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
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.message.content;
  } finally {
    clearTimeout(timer);
  }
}

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

const args = parseArgs(process.argv.slice(2));
const packet = await readFile(args.packet, "utf8");

let response;
try {
  response = await callOllama(args.model, packet);
} catch (err) {
  console.error(`EXECUTOR ERROR: ${err.message}`);
  process.exit(2);
}

await writeFile(args.out, response);
const blocks = [...response.matchAll(BLOCK_RE)].map((m) => ({ lang: m[1], path: m[2], code: m[3] }));

if (blocks.length === 0) {
  console.error(`EXECUTOR RETURNED NO CODE BLOCKS — see ${args.out}`);
  process.exit(3);
}

console.log(`Executor returned ${blocks.length} file(s):`);
for (const b of blocks) console.log("  -", b.path);

if (args.apply) {
  for (const b of blocks) {
    const target = resolve(args.root, b.path);
    await mkdir(dirname(target), { recursive: true });
    if (await exists(target)) await copyFile(target, `${target}.bak`);
    await writeFile(target, b.code);
    console.log("  wrote", target);
  }
}
