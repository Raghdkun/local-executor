#!/usr/bin/env node
/**
 * Reports whether Ollama is running and has the configured model.
 * Works on macOS, Linux, Windows. Exit 0 = ready; 1 = something missing.
 *
 * Usage: node check_local.mjs [--json]
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const configPath = join(here, "config.json");
const json = process.argv.includes("--json");

function report(status, message, extra = {}) {
  if (json) console.log(JSON.stringify({ status, message, config: configPath, ...extra }));
  else console.log(`${status}: ${message}`);
}

let config;
try {
  config = JSON.parse(await readFile(configPath, "utf8"));
} catch (err) {
  report("BROKEN CONFIG", `cannot read ${configPath}: ${err.message}. Re-run: npx local-executor`);
  process.exit(1);
}

let tags;
try {
  const res = await fetch(`${config.ollama_url}/api/tags`, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  tags = await res.json();
} catch {
  report(
    "NOT RUNNING",
    `ollama server not reachable at ${config.ollama_url}. Start it (open the Ollama app, or run: ollama serve) or install it: npx local-executor`,
    { model: config.model },
  );
  process.exit(1);
}

const names = (tags.models ?? []).map((m) => m.name);
const have = names.includes(config.model) || names.includes(`${config.model}:latest`);
if (!have) {
  report("MISSING MODEL", `${config.model} not pulled. Run: ollama pull ${config.model}`, {
    model: config.model,
    available: names,
  });
  process.exit(1);
}

report("READY", `ollama running at ${config.ollama_url} with model ${config.model}`, {
  model: config.model,
  available: names,
});
