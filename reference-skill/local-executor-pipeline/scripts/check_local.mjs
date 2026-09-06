#!/usr/bin/env node
// Reports whether Ollama is running and has the configured model. Works on macOS, Linux, Windows.
// Exit 0 = ready. Exit 1 = something missing (message says what).
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(await readFile(join(here, "config.json"), "utf8"));

let tags;
try {
  const res = await fetch(`${config.ollama_url}/api/tags`, { signal: AbortSignal.timeout(3000) });
  tags = await res.json();
} catch {
  console.log(`NOT RUNNING: ollama server not reachable at ${config.ollama_url}. Install from https://ollama.com/download or run: ollama serve`);
  process.exit(1);
}

const names = (tags.models ?? []).map((m) => m.name);
if (!names.includes(config.model)) {
  console.log(`MISSING MODEL: ${config.model} not pulled. Run: ollama pull ${config.model}`);
  if (names.length) console.log(`Available: ${names.join(", ")}`);
  process.exit(1);
}

console.log(`READY: ollama running at ${config.ollama_url} with model ${config.model}`);
