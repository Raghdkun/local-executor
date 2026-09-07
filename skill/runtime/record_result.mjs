#!/usr/bin/env node
/**
 * Record what happened after an executor run: did the tests pass, what did
 * the auditor say. Appends an event to <root>/.lex/runs.jsonl so `lex stats`
 * can compute first-attempt pass rates per model and packet size.
 *
 * Usage:
 *   node record_result.mjs --run <runId> --tests pass|fail [--root .]
 *   node record_result.mjs --run <runId> --audit accept|reject [--model <auditor>] [--root .]
 *   node record_result.mjs --run <runId> --escalated "<why>" [--root .]
 */
import { appendFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function parseArgs(argv) {
  const a = { root: "." };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--run") a.run = argv[++i];
    else if (k === "--tests") a.tests = argv[++i];
    else if (k === "--audit") a.audit = argv[++i];
    else if (k === "--model") a.model = argv[++i];
    else if (k === "--escalated") a.escalated = argv[++i];
    else if (k === "--root") a.root = argv[++i];
  }
  return a;
}

export function buildEvent(a, now = new Date()) {
  if (!a.run) throw new Error("--run <runId> is required");
  const ev = { type: "result", run: a.run, at: now.toISOString() };
  if (a.tests) {
    if (!["pass", "fail"].includes(a.tests)) throw new Error("--tests must be pass or fail");
    ev.tests = a.tests;
  }
  if (a.audit) {
    if (!["accept", "reject"].includes(a.audit))
      throw new Error("--audit must be accept or reject");
    ev.audit = a.audit;
    if (a.model) ev.auditor = a.model;
  }
  if (a.escalated) ev.escalated = a.escalated;
  if (!ev.tests && !ev.audit && !ev.escalated)
    throw new Error("nothing to record: pass --tests, --audit, or --escalated");
  return ev;
}

export async function appendEvent(root, ev) {
  const dir = join(resolve(root), ".lex");
  await mkdir(dir, { recursive: true });
  await appendFile(join(dir, "runs.jsonl"), `${JSON.stringify(ev)}\n`);
  return join(dir, "runs.jsonl");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const a = parseArgs(process.argv.slice(2));
    const ev = buildEvent(a);
    const file = await appendEvent(a.root, ev);
    console.log(`recorded ${JSON.stringify(ev)} → ${file}`);
  } catch (err) {
    console.error(`record_result: ${err.message}`);
    console.error(
      "usage: record_result.mjs --run <id> (--tests pass|fail | --audit accept|reject [--model m] | --escalated <why>) [--root .]",
    );
    process.exit(2);
  }
}
