import { installTarget } from "../agents/install.js";
import { resolveTargets } from "../agents/paths.js";
import { renderModelsDoc } from "../models/doc.js";
import { recommendNumCtx } from "../models/recommend.js";
import { contractTilde, home } from "../util/fs.js";
import * as log from "../util/log.js";
import { packageVersion, skillSourceDir } from "../util/pkg.js";
import { readManifest, upsertInstall, writeManifest } from "../util/state.js";
import type { RunContext } from "./context.js";

export async function stepSkills(ctx: RunContext): Promise<void> {
  log.header(
    "5/6",
    "Skill install",
    "One canonical pipeline body plus a thin adapter per agent, with paths rewritten for each location.",
  );
  if (ctx.agents.length === 0) {
    log.info("Nothing to install.");
    return;
  }
  if (!ctx.hw || !ctx.report || !ctx.model)
    throw new Error("internal: hardware and model steps must run first");

  const targets = resolveTargets(
    ctx.agents,
    { home: home(), projectRoot: ctx.projectRoot },
    { project: ctx.installProject },
  );
  const modelsDoc = renderModelsDoc(ctx.hw, ctx.report, ctx.model);
  const version = packageVersion();
  const numCtx = recommendNumCtx(ctx.report.effectiveMemory.gb, ctx.modelSizeGB);
  let manifest = await readManifest();

  for (const target of targets) {
    const outcome = await installTarget({
      target,
      skillSource: skillSourceDir(),
      model: ctx.model,
      ollamaUrl: ctx.client.baseUrl,
      version,
      modelsDoc,
      benchmark: ctx.benchmark ?? null,
      numCtx,
      projectRoot: ctx.projectRoot,
    });
    ctx.installs.push(outcome);
    manifest = upsertInstall(manifest, outcome.record);
    log.success(`${target.summary}`);
    for (const a of outcome.actions) log.message(log.pc.dim(`  ${a.replace(home(), "~")}`));
  }

  manifest.model = ctx.model;
  await writeManifest(manifest);
  log.info(
    `Context window (num_ctx) for new installs: ${numCtx} tokens${numCtx > 16384 ? " (this machine has headroom for it)" : ""}.`,
  );
  log.info(`Install manifest: ${contractTilde((await import("../util/state.js")).manifestPath())}`);
}
