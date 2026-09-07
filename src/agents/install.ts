import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { Benchmark } from "../ollama/client.js";
import {
  copyDir,
  ensureDir,
  exists,
  isDirectory,
  readJsonOr,
  readTextOr,
  removePath,
  toPosix,
  writeJson,
  writeText,
} from "../util/fs.js";
import { removeBlock, upsertBlock } from "../util/markers.js";
import type { InstallRecord } from "../util/state.js";
import { configPathFor, type InstallTarget } from "./paths.js";

export interface TemplateVars {
  LEX_ROOT: string;
  LEX_CORE: string;
  LEX_RUNTIME: string;
  LEX_CONFIG: string;
  LEX_MODEL: string;
  LEX_VERSION: string;
}

export function templateVars(root: string, model: string, version: string): TemplateVars {
  const r = toPosix(root);
  return {
    LEX_ROOT: r,
    LEX_CORE: `${r}/core`,
    LEX_RUNTIME: `${r}/runtime`,
    LEX_CONFIG: `${r}/runtime/config.json`,
    LEX_MODEL: model,
    LEX_VERSION: version,
  };
}

/** Replace `{{KEY}}` placeholders. Unknown keys are left untouched so they are visible. */
export function renderTemplate(text: string, vars: TemplateVars): string {
  return text.replace(/\{\{(LEX_[A-Z_]+)\}\}/g, (whole, key: string) =>
    key in vars ? vars[key as keyof TemplateVars] : whole,
  );
}

export interface RuntimeConfig {
  ollama_url: string;
  model: string;
  fallback_model?: string;
  num_ctx: number;
  temperature: number;
  keep_alive: string;
  timeout_seconds: number;
  think: boolean;
  /** Measured speed for `model`; dropped automatically when the model changes. */
  benchmark?: Benchmark;
}

export const defaultRuntimeConfig: RuntimeConfig = {
  ollama_url: "http://localhost:11434",
  model: "qwen3.5:9b",
  fallback_model: "qwen3.5:4b",
  num_ctx: 16384,
  temperature: 0.1,
  keep_alive: "30m",
  timeout_seconds: 600,
  think: false,
};

export interface InstallInput {
  target: InstallTarget;
  /** Absolute path to the package's `skill/` directory. */
  skillSource: string;
  model: string;
  ollamaUrl: string;
  version: string;
  /** Pre-rendered `core/models.md` for this machine. */
  modelsDoc: string;
  /** Speed measurement for `model`, stored so the runner can estimate packet time. */
  benchmark?: Benchmark | null;
  /** Context window for fresh installs; an existing config keeps its own value. */
  numCtx?: number;
  /** Smaller, faster model for mechanical packets; set on fresh installs only. */
  fallbackModel?: string;
  /** Repo root for project-scope installs; gets a `.lex/.gitignore`. */
  projectRoot?: string | null;
}

export interface InstallOutcome {
  record: InstallRecord;
  /** Human-readable list of what happened, for the summary. */
  actions: string[];
}

async function copyCore(src: string, dest: string, vars: TemplateVars): Promise<void> {
  await ensureDir(dest);
  for (const name of await readdir(src)) {
    const text = await readFile(join(src, name), "utf8");
    await writeText(join(dest, name), name.endsWith(".md") ? renderTemplate(text, vars) : text);
  }
}

/**
 * Install one target. Idempotent: re-running overwrites our own files, keeps
 * user edits to config.json fields other than model/ollama_url, and replaces
 * (never duplicates) marker blocks in shared files.
 */
export async function installTarget(input: InstallInput): Promise<InstallOutcome> {
  const { target, skillSource, model, version } = input;
  const actions: string[] = [];
  const vars = templateVars(target.root, model, version);
  const ownsRoot = target.scope === "user" || target.agent === "claude";
  const owned: string[] = [];
  const marked: string[] = [];

  if (ownsRoot) {
    const existed = await exists(target.root);
    await ensureDir(target.root);
    await copyCore(join(skillSource, "core"), join(target.root, "core"), vars);
    await writeText(join(target.root, "core", "models.md"), input.modelsDoc);
    // Runtime scripts are copied verbatim; config.json is merged below.
    const runtimeDest = join(target.root, "runtime");
    const configPath = configPathFor(target.root);
    const existing = await readJsonOr<Partial<RuntimeConfig>>(configPath, {});
    await ensureDir(runtimeDest);
    await copyDir(join(skillSource, "runtime"), runtimeDest);
    const shipped = await readJsonOr<Partial<RuntimeConfig>>(
      join(skillSource, "runtime", "config.json"),
      {},
    );
    const fresh = Object.keys(existing).length === 0;
    const merged: RuntimeConfig = {
      ...defaultRuntimeConfig,
      ...shipped,
      ...existing,
      ...(fresh && input.numCtx ? { num_ctx: input.numCtx } : {}),
      ...(fresh && input.fallbackModel ? { fallback_model: input.fallbackModel } : {}),
      model,
      ollama_url: input.ollamaUrl,
    };
    if (input.benchmark && input.benchmark.model === model) merged.benchmark = input.benchmark;
    else if (merged.benchmark && merged.benchmark.model !== model) delete merged.benchmark;
    await writeJson(configPath, merged);
    owned.push(target.root);
    actions.push(`${existed ? "Updated" : "Created"} ${target.root}`);
  }

  if (target.scope === "project" && input.projectRoot) {
    // Packets, responses, and backups live in <repo>/.lex; keep them out of git
    // without touching the user's .gitignore.
    const lexIgnore = join(input.projectRoot, ".lex", ".gitignore");
    if (!(await exists(lexIgnore))) {
      await writeText(lexIgnore, "*\n");
      actions.push(`Created ${lexIgnore} (keeps packets and backups out of git)`);
    }
  }

  for (const a of target.adapters) {
    const text = await readFile(join(skillSource, "adapters", a.source), "utf8");
    await writeText(a.dest, renderTemplate(text, vars));
    if (!ownsRoot || !a.dest.startsWith(target.root)) owned.push(a.dest);
    actions.push(`Wrote ${a.dest}`);
  }

  for (const o of target.optional) {
    if (!(await isDirectory(o.ifDirExists))) continue;
    const text = await readFile(join(skillSource, "adapters", o.adapter.source), "utf8");
    await writeText(o.adapter.dest, renderTemplate(text, vars));
    owned.push(
      dirname(o.adapter.dest) === o.ifDirExists ? o.adapter.dest : dirname(o.adapter.dest),
    );
    actions.push(`Wrote ${o.adapter.dest}`);
  }

  for (const m of target.marked) {
    const body = renderTemplate(
      await readFile(join(skillSource, "adapters", m.source), "utf8"),
      vars,
    );
    const current = await readTextOr(m.dest, "");
    const next = upsertBlock(current, body);
    if (next !== current) await writeText(m.dest, next);
    marked.push(m.dest);
    actions.push(
      `${current.includes("<!-- lex:start -->") ? "Refreshed" : "Appended"} lex block in ${m.dest}`,
    );
  }

  const record: InstallRecord = {
    agent: target.agent,
    scope: target.scope,
    root: target.root,
    configPath: configPathFor(target.root),
    owned,
    marked,
    installedAt: new Date().toISOString(),
    version,
  };
  return { record, actions };
}

/** Reverse an install record. Never deletes files we merely appended to. */
export async function uninstallRecord(rec: InstallRecord): Promise<string[]> {
  const actions: string[] = [];
  for (const p of rec.owned) {
    if (await exists(p)) {
      await removePath(p);
      actions.push(`Removed ${p}`);
    }
  }
  for (const f of rec.marked) {
    const current = await readTextOr(f, "");
    if (!current) continue;
    const next = removeBlock(current);
    if (next === current) continue;
    if (next.trim().length === 0 && basename(f) === "AGENTS.md") {
      // Only our block was in it; leave an empty file rather than guessing whether the user wants it.
      await writeText(f, "");
    } else {
      await writeText(f, next);
    }
    actions.push(`Removed lex block from ${f}`);
  }
  return actions;
}

/**
 * Update the model (and its benchmark) in an installed config.json. A stale
 * benchmark for a different model is dropped. Returns false if the file is missing.
 */
export async function updateConfigModel(
  configPath: string,
  model: string,
  benchmark?: Benchmark | null,
): Promise<boolean> {
  if (!(await exists(configPath))) return false;
  const cfg = await readJsonOr<Partial<RuntimeConfig>>(configPath, {});
  const next: RuntimeConfig = { ...defaultRuntimeConfig, ...cfg, model };
  if (benchmark && benchmark.model === model) next.benchmark = benchmark;
  else if (next.benchmark && next.benchmark.model !== model) delete next.benchmark;
  await writeJson(configPath, next);
  return true;
}
