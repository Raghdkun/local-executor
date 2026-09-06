import { join } from "node:path";
import {
  appCandidates,
  type InstallPlan,
  planOllamaInstall,
  planServerStart,
} from "../ollama/install.js";
import { isOutdated, latestOllamaVersion, releaseCachePath } from "../ollama/release.js";
import { displayCommand, openUrl, run, spawnDetached, which } from "../util/exec.js";
import { exists, readJsonOr, writeJson } from "../util/fs.js";
import * as log from "../util/log.js";
import { cacheDir } from "../util/state.js";
import type { RunContext } from "./context.js";

function platformOf(): "darwin" | "linux" | "win32" {
  return process.platform === "darwin" || process.platform === "win32" ? process.platform : "linux";
}

async function fetchLatest(): Promise<string | null> {
  const cachePath = releaseCachePath(cacheDir());
  return latestOllamaVersion({
    fetchImpl: (i, o) => fetch(i, o),
    readCache: () => readJsonOr(cachePath, null),
    writeCache: (c) => writeJson(cachePath, c),
    now: () => Date.now(),
  });
}

export function upgradePlan(plan: InstallPlan): InstallPlan {
  if (plan.kind !== "command") return plan;
  if (plan.file === "brew") {
    return {
      ...plan,
      args: ["upgrade", "ollama"],
      display: displayCommand("brew", ["upgrade", "ollama"]),
    };
  }
  if (plan.file === "winget") {
    const args = [
      "upgrade",
      "--id",
      "Ollama.Ollama",
      "-e",
      "--accept-source-agreements",
      "--accept-package-agreements",
    ];
    return {
      ...plan,
      args,
      display: displayCommand("winget", ["upgrade", "--id", "Ollama.Ollama", "-e"]),
    };
  }
  return plan; // Linux script upgrades in place.
}

/** Show the exact command, explain it, ask, run. Returns true when it ran and exited 0. */
async function runPlan(ctx: RunContext, plan: InstallPlan, verb: string): Promise<boolean> {
  if (plan.kind === "download") {
    log.warn(plan.explanation);
    log.info(`Opening ${plan.url}`);
    await openUrl(plan.url);
    ctx.warnings.push(`Ollama must be ${verb}ed manually from ${plan.url}; re-run lex afterwards.`);
    return false;
  }
  log.note(`${log.code(plan.display)}\n\n${plan.explanation}`, `Command to ${verb} Ollama`);
  const nonInteractive = log.nonInteractive();
  if (nonInteractive && !ctx.opts.allowInstall) {
    log.warn(
      `Not running ${verb} without confirmation (non-interactive). Pass --allow-install to permit it.`,
    );
    ctx.warnings.push(`Ollama ${verb} skipped in non-interactive mode. Run: ${plan.display}`);
    return false;
  }
  const ok = await log.confirm(
    `Run this now?${plan.privileged ? " (it will ask for sudo)" : ""}`,
    true,
  );
  if (!ok) {
    ctx.warnings.push(`Ollama ${verb} declined. Run it yourself: ${plan.display}`);
    return false;
  }
  const sp = log.spinner();
  if (!log.ui.tty) sp.start(`Running: ${plan.display}`);
  const result = await run(plan.file, plan.args, { inherit: true });
  if (!result.ok) {
    log.error(`${plan.display} exited with code ${result.exitCode ?? "?"}.`);
    ctx.warnings.push(`Ollama ${verb} command failed (exit ${result.exitCode ?? "?"}).`);
    return false;
  }
  log.success(`Ollama ${verb} command finished.`);
  return true;
}

async function startServer(ctx: RunContext): Promise<boolean> {
  const platform = platformOf();
  const env = process.env;
  const candidates = appCandidates(platform, env);
  let appPath: string | null = null;
  for (const c of candidates) if (await exists(c)) appPath = c;
  const plan = planServerStart(platform, {
    macAppPresent: platform === "darwin" && appPath !== null,
    winAppPath: platform === "win32" ? appPath : null,
  });
  log.info(`Starting the server: ${log.code(plan.display)}`);
  if (plan.usesApp && platform === "darwin") await run(plan.file, plan.args);
  else spawnDetached(plan.file, plan.args);
  const sp = log.spinner();
  sp.start("Waiting for Ollama to answer on the health endpoint…");
  const up = await ctx.client.waitUntilUp(30_000);
  if (up) sp.stop("Ollama is running.");
  else sp.error("Ollama did not respond within 30 s.");
  return up;
}

export async function stepOllama(ctx: RunContext): Promise<void> {
  log.header(
    "1/6",
    "Ollama",
    "The local server that runs the executor model. Detect, install, start, and check the version.",
  );

  if (ctx.opts.skipOllama) {
    ctx.ollama.skipped = true;
    log.warn(
      "Skipping Ollama setup (--skip-ollama). Later steps will re-check the server and warn if it is down.",
    );
  } else if (!log.nonInteractive()) {
    const choice = await log.select(
      "Ollama setup",
      [
        { value: "run", label: "Detect and set up Ollama for me", hint: "recommended" },
        { value: "skip", label: "Skip — I manage Ollama myself" },
      ],
      "run",
    );
    ctx.ollama.skipped = choice === "skip";
  }

  ctx.ollama.binary = await which("ollama");
  ctx.ollama.version = await ctx.client.version();

  if (ctx.ollama.skipped) {
    if (ctx.ollama.version)
      log.success(`Ollama ${ctx.ollama.version} is reachable at ${ctx.client.baseUrl}.`);
    else
      log.warn(
        `Ollama is not reachable at ${ctx.client.baseUrl}. Model pull and verification will be skipped.`,
      );
    return;
  }

  const platform = platformOf();
  const env = {
    platform,
    hasBrew: (await which("brew")) !== null,
    hasWinget: (await which("winget")) !== null,
  };

  if (!ctx.ollama.binary && !ctx.ollama.version) {
    log.warn("Ollama is not installed (not on PATH, server not responding).");
    const installed = await runPlan(ctx, planOllamaInstall(env), "install");
    if (!installed) return;
    ctx.ollama.binary = await which("ollama");
    ctx.ollama.version = await ctx.client.version();
  } else if (ctx.ollama.binary && !ctx.ollama.version) {
    log.info(
      `Ollama binary found at ${ctx.ollama.binary}, but the server is not responding at ${ctx.client.baseUrl}.`,
    );
  } else {
    log.success(`Ollama ${ctx.ollama.version} is running at ${ctx.client.baseUrl}.`);
  }

  if (!ctx.ollama.version) {
    const up = await startServer(ctx);
    if (!up) {
      ctx.warnings.push(
        "Ollama server could not be started. Start it manually (open the Ollama app or run `ollama serve`).",
      );
      return;
    }
    ctx.ollama.version = await ctx.client.version();
  }

  // Version check: cached for 24h, fail-soft when offline.
  ctx.ollama.latest = await fetchLatest();
  if (ctx.ollama.latest && ctx.ollama.version) {
    if (isOutdated(ctx.ollama.version, ctx.ollama.latest)) {
      log.warn(`Ollama ${ctx.ollama.version} is installed; latest is ${ctx.ollama.latest}.`);
      if (log.nonInteractive()) {
        ctx.warnings.push(
          `Ollama is outdated (${ctx.ollama.version} < ${ctx.ollama.latest}). Upgrade when convenient.`,
        );
      } else {
        const want = await log.confirm("Upgrade Ollama now?", false);
        if (want) {
          const done = await runPlan(ctx, upgradePlan(planOllamaInstall(env)), "upgrade");
          if (done) log.info("Restart the Ollama app/server to pick up the new version.");
        }
      }
    } else {
      log.info(`Ollama is up to date (latest release: ${ctx.ollama.latest}).`);
    }
  } else if (!ctx.ollama.latest) {
    log.info(
      "Could not check the latest Ollama release (offline or rate-limited); skipping the version check.",
    );
  }

  // Ensure the model store dir is known for the disk check later.
  if (!process.env.OLLAMA_MODELS) {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
    const dir = join(home, ".ollama", "models");
    if (!(await exists(dir))) log.info(`Model store will be created at ${dir} on first pull.`);
  }
}
