import { findModel } from "../models/catalog.js";
import type { Recommendation } from "../models/recommend.js";
import { formatPullLine, PullTracker } from "../ollama/progress.js";
import * as log from "../util/log.js";
import type { RunContext } from "./context.js";

const CUSTOM = "__custom__";

export function isValidTag(tag: string): boolean {
  return /^[a-zA-Z0-9._\-/]+(:[a-zA-Z0-9._-]+)?$/.test(tag);
}

function choiceFor(r: Recommendation): log.Choice<string> {
  const flags = [
    r.recommended ? "recommended" : null,
    !r.fitsDisk ? "needs more disk" : null,
    !r.fitsMemory ? "may swap" : null,
  ].filter(Boolean);
  const hint = `~${r.sizeGB} GB · ${r.reason}${flags.length ? ` · ${flags.join(", ")}` : ""}`;
  return { value: r.tag, label: r.recommended ? `${r.tag}  ★` : r.tag, hint };
}

export async function chooseModel(ctx: RunContext): Promise<string> {
  if (ctx.opts.model) {
    if (!isValidTag(ctx.opts.model))
      throw new Error(`"${ctx.opts.model}" does not look like an Ollama tag.`);
    return ctx.opts.model;
  }
  const list = ctx.report?.list ?? [];
  const top = list.find((r) => r.recommended)?.tag ?? "qwen3.5:9b";
  if (log.nonInteractive()) return top;
  const picked = await log.select(
    "Executor model",
    [
      ...list.map(choiceFor),
      { value: CUSTOM, label: "Enter a custom tag…", hint: "any tag from ollama.com/library" },
    ],
    top,
  );
  if (picked !== CUSTOM) return picked;
  for (;;) {
    const tag = await log.text("Ollama tag", "e.g. qwen3.5:9b-q8_0", top);
    if (isValidTag(tag)) return tag;
    log.warn(`"${tag}" does not look like a valid tag.`);
  }
}

export async function pullModel(ctx: RunContext, tag: string): Promise<boolean> {
  const sp = log.spinner();
  const tracker = new PullTracker();
  let lastPercent = -1;
  sp.start(`Pulling ${tag}…`);
  try {
    await ctx.client.pull(tag, (e) => {
      const s = tracker.update(e);
      if (s.percent !== lastPercent || s.percent === null) {
        lastPercent = s.percent ?? -1;
        sp.message(formatPullLine(tag, s));
      }
    });
    sp.stop(`Pulled ${tag}.`);
    return true;
  } catch (err) {
    sp.error(`Pull failed: ${(err as Error).message}`);
    return false;
  }
}

export async function warmupModel(ctx: RunContext, tag: string): Promise<void> {
  const sp = log.spinner();
  sp.start(`Loading ${tag} and measuring speed (first load can take 10–30 s)…`);
  try {
    const w = await ctx.client.warmup(tag);
    ctx.warmup = w;
    const speed = w.tokensPerSec !== null ? `${w.tokensPerSec} tok/s` : "speed unknown";
    sp.stop(
      `${tag} ready: ${log.pc.bold(speed)} (load ${Math.round(w.loadDurationMs / 100) / 10} s, ${w.evalCount} tokens generated)`,
    );
  } catch (err) {
    ctx.warmup = null;
    sp.error(`Warm-up failed: ${(err as Error).message}`);
    ctx.warnings.push(`Warm-up request failed for ${tag}; the model may not have loaded.`);
  }
}

export async function stepModel(ctx: RunContext): Promise<void> {
  log.header(
    "3/6",
    "Model",
    "Pick the executor model, pull it, and measure real tokens/sec on this machine.",
  );
  const tag = await chooseModel(ctx);
  ctx.model = tag;
  const known = findModel(tag);
  const rec = ctx.report?.list.find((r) => r.tag === tag);
  if (known) ctx.modelSizeGB = known.sizeGB;
  for (const w of rec?.warnings ?? []) log.warn(w);

  const up = await ctx.client.isUp();
  if (!up) {
    log.warn(
      `Ollama is not reachable at ${ctx.client.baseUrl}; skipping pull and warm-up. Config will still point at ${tag}.`,
    );
    ctx.warnings.push(
      `Model ${tag} was not pulled because Ollama was unreachable. Run: ollama pull ${tag}`,
    );
    ctx.pulled = false;
    return;
  }

  const have = await ctx.client.hasModel(tag).catch(() => false);
  if (have) {
    log.success(`${tag} is already pulled.`);
    ctx.pulled = true;
  } else if (ctx.opts.skipPull) {
    log.warn(`--skip-pull: not pulling ${tag}. Run: ollama pull ${tag}`);
    ctx.warnings.push(`Model ${tag} not pulled (--skip-pull).`);
    ctx.pulled = false;
  } else {
    const size = known ? `about ${known.sizeGB} GB` : "size unknown (not in the catalog)";
    log.info(`Download: ${size}. Downloads over 100 MB always ask first unless --yes was given.`);
    const ok = await log.confirm(`Pull ${tag} now?`, true);
    if (!ok) {
      ctx.warnings.push(`Model ${tag} not pulled. Run: ollama pull ${tag}`);
      ctx.pulled = false;
    } else {
      ctx.pulled = await pullModel(ctx, tag);
      if (!ctx.pulled)
        ctx.warnings.push(
          `Pull of ${tag} failed. Check the tag on ollama.com/library and retry: ollama pull ${tag}`,
        );
    }
  }

  if (ctx.pulled) await warmupModel(ctx, tag);
}
