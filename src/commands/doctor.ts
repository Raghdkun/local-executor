import { join } from "node:path";
import { type Benchmark, estimateSecondsPerPacket, OllamaClient } from "../ollama/client.js";
import { isOutdated, latestOllamaVersion, releaseCachePath } from "../ollama/release.js";
import { which } from "../util/exec.js";
import { contractTilde, exists, readJsonOr, writeJson } from "../util/fs.js";
import * as log from "../util/log.js";
import { cacheDir, manifestPath, readManifest } from "../util/state.js";

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
  /** Soft failures do not affect the exit code. */
  warn?: boolean;
}

export async function collectDoctorChecks(ollamaUrl: string): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const client = new OllamaClient(ollamaUrl);

  const bin = await which("ollama");
  checks.push({ name: "ollama binary", ok: bin !== null, detail: bin ?? "not on PATH" });

  const version = await client.version();
  checks.push({
    name: "ollama server",
    ok: version !== null,
    detail: version ? `v${version} at ${ollamaUrl}` : `not reachable at ${ollamaUrl}`,
  });

  if (version) {
    const cachePath = releaseCachePath(cacheDir());
    const latest = await latestOllamaVersion({
      fetchImpl: (i, o) => fetch(i, o),
      readCache: () => readJsonOr(cachePath, null),
      writeCache: (c) => writeJson(cachePath, c),
      now: () => Date.now(),
    });
    if (latest) {
      const outdated = isOutdated(version, latest);
      checks.push({
        name: "ollama version",
        ok: !outdated,
        warn: true,
        detail: outdated ? `latest is ${latest}` : `up to date (${latest})`,
      });
    } else {
      checks.push({
        name: "ollama version",
        ok: true,
        warn: true,
        detail: "latest release unknown (offline)",
      });
    }
  }

  const manifest = await readManifest();
  checks.push({
    name: "install manifest",
    ok: manifest.installs.length > 0,
    detail:
      manifest.installs.length > 0
        ? `${manifest.installs.length} install(s) in ${contractTilde(manifestPath())}`
        : "no installs recorded — run `lex init`",
  });

  const localModels = version
    ? await client
        .list()
        .then((l) => l.map((m) => m.name))
        .catch(() => [])
    : [];
  for (const rec of manifest.installs) {
    const label = `${rec.agent}/${rec.scope}`;
    const ownsRoot = rec.owned.includes(rec.root);
    if (ownsRoot) {
      const files = [
        "core/PIPELINE.md",
        "core/executor-system-prompt.md",
        "runtime/run_executor.mjs",
        "runtime/check_local.mjs",
        "runtime/config.json",
      ];
      const missing: string[] = [];
      for (const f of files) if (!(await exists(join(rec.root, f)))) missing.push(f);
      checks.push({
        name: `${label} files`,
        ok: missing.length === 0,
        detail:
          missing.length === 0
            ? contractTilde(rec.root)
            : `missing ${missing.join(", ")} in ${contractTilde(rec.root)}`,
      });
      const cfg = await readJsonOr<{ model?: string; benchmark?: Benchmark; num_ctx?: number }>(
        rec.configPath,
        {},
      );
      const model = cfg.model ?? "(none)";
      const pulled = localModels.includes(model) || localModels.includes(`${model}:latest`);
      checks.push({
        name: `${label} model`,
        ok: version === null ? false : pulled,
        detail:
          version === null
            ? `${model} (server down, cannot check)`
            : pulled
              ? `${model} pulled`
              : `${model} not pulled — run: ollama pull ${model}`,
      });
      const b = cfg.benchmark && cfg.benchmark.model === model ? cfg.benchmark : null;
      const eta = estimateSecondsPerPacket(b);
      checks.push({
        name: `${label} speed`,
        ok: b !== null,
        warn: true,
        detail:
          b && eta !== null
            ? `${b.gen_tps} gen / ${b.prompt_tps} prompt tok/s, ~${eta < 90 ? `${eta} s` : `${Math.round(eta / 60)} min`} per packet, num_ctx ${cfg.num_ctx ?? 16384}`
            : `unmeasured — run: node ${contractTilde(rec.root)}/runtime/check_local.mjs --bench`,
      });
    }
    for (const o of rec.owned.filter((p) => p !== rec.root)) {
      checks.push({ name: `${label} adapter`, ok: await exists(o), detail: contractTilde(o) });
    }
    for (const m of rec.marked) {
      const text = await import("node:fs/promises")
        .then((fs) => fs.readFile(m, "utf8"))
        .catch(() => "");
      checks.push({
        name: `${label} block`,
        ok: text.includes("<!-- lex:start -->"),
        detail: contractTilde(m),
      });
    }
  }
  return checks;
}

export async function runDoctor(opts: { json: boolean; ollamaUrl: string }): Promise<number> {
  log.configureUi({ json: opts.json });
  const checks = await collectDoctorChecks(opts.ollamaUrl);
  const failures = checks.filter((c) => !c.ok && !c.warn);
  if (opts.json) {
    process.stdout.write(`${JSON.stringify({ ok: failures.length === 0, checks }, null, 2)}\n`);
    return failures.length === 0 ? 0 : 1;
  }
  log.intro("lex doctor");
  const rows: [string, string][] = checks.map((c) => [
    c.name,
    `${c.ok ? log.pc.green("ok  ") : c.warn ? log.pc.yellow("warn") : log.pc.red("FAIL")}  ${c.detail}`,
  ]);
  log.table(rows);
  log.outro(
    failures.length === 0
      ? log.pc.green("All checks passed.")
      : log.pc.red(`${failures.length} check(s) failed.`),
  );
  return failures.length === 0 ? 0 : 1;
}
