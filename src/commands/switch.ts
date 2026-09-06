import { updateConfigModel } from "../agents/install.js";
import { findModel } from "../models/catalog.js";
import { OllamaClient } from "../ollama/client.js";
import type { RunContext } from "../steps/context.js";
import { isValidTag, pullModel, warmupModel } from "../steps/model.js";
import { contractTilde } from "../util/fs.js";
import * as log from "../util/log.js";
import { readManifest, writeManifest } from "../util/state.js";

export async function runSwitch(
  tag: string,
  opts: { yes: boolean; json: boolean; ollamaUrl: string },
): Promise<number> {
  log.configureUi({ yes: opts.yes, json: opts.json });
  if (!isValidTag(tag)) {
    log.error(`"${tag}" does not look like an Ollama tag.`);
    return 1;
  }
  const manifest = await readManifest();
  if (manifest.installs.length === 0) {
    log.error("No installs recorded. Run `lex init` first.");
    return 1;
  }
  log.intro(`lex switch ${tag}`);
  const client = new OllamaClient(opts.ollamaUrl);
  const ctx = {
    client,
    opts: { ...opts, skipPull: false },
    warnings: [] as string[],
  } as unknown as RunContext;
  let pulled = false;
  if (await client.isUp()) {
    if (await client.hasModel(tag).catch(() => false)) {
      log.success(`${tag} is already pulled.`);
      pulled = true;
    } else {
      const known = findModel(tag);
      log.info(
        `Download: ${known ? `about ${known.sizeGB} GB` : "size unknown (not in the catalog)"}.`,
      );
      if (await log.confirm(`Pull ${tag} now?`, true)) pulled = await pullModel(ctx, tag);
      if (!pulled) {
        log.error(`Could not pull ${tag}; configs were not changed.`);
        return 2;
      }
    }
    await warmupModel(ctx, tag);
  } else {
    log.warn(
      `Ollama is not reachable at ${opts.ollamaUrl}; updating configs without pulling. Run: ollama pull ${tag}`,
    );
  }

  const updated: string[] = [];
  const missing: string[] = [];
  for (const rec of manifest.installs) {
    if (!rec.owned.includes(rec.root)) continue;
    if (await updateConfigModel(rec.configPath, tag)) updated.push(rec.configPath);
    else missing.push(rec.configPath);
  }
  manifest.model = tag;
  await writeManifest(manifest);
  for (const u of updated) log.success(`Updated ${contractTilde(u)}`);
  for (const m of missing) log.warn(`Missing ${contractTilde(m)} (re-run lex init)`);
  if (opts.json)
    process.stdout.write(
      `${JSON.stringify({ ok: true, model: tag, pulled, tokensPerSec: ctx.warmup?.tokensPerSec ?? null, updated, missing })}\n`,
    );
  else log.outro(`Executor model is now ${tag} in ${updated.length} config file(s).`);
  return 0;
}
