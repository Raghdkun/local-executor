import { findModel } from "../models/catalog.js";
import type { Recommendation } from "../models/recommend.js";
import { estimateSecondsPerPacket } from "../ollama/client.js";
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
  let top = list.find((r) => r.recommended)?.tag ?? "qwen3.5:9b";
  if (ctx.client.isRemote) {
    // A shared box already has models; default to the largest pulled one that
    // the catalog knows, otherwise the largest pulled model at all.
    const remote = await ctx.client.list().catch(() => []);
    if (remote.length > 0) {
      const known = remote.filter((m) => findModel(m.name.replace(/:latest$/, "")));
      const pick = (known.length ? known : remote).sort((a, b) => b.sizeBytes - a.sizeBytes)[0];
      if (pick) {
        top = pick.name.replace(/:latest$/, "");
        log.info(
          `Models pulled on ${ctx.client.baseUrl}: ${remote.map((m) => m.name).join(", ")}. Defaulting to ${top}.`,
        );
      }
    } else {
      log.warn(
        `No models are pulled on ${ctx.client.baseUrl}; the pull below will happen on that box.`,
      );
    }
  }
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

export function formatMinutes(seconds: number): string {
  return seconds < 90 ? `${seconds} s` : `${Math.round(seconds / 60)} min`;
}

/**
 * Load the model and measure prompt and generation speed with a ~2k-token
 * prompt. The result is stored in every config.json so the runner and
 * check_local can say how long a packet will take.
 */
export async function warmupModel(ctx: RunContext, tag: string): Promise<void> {
  const sp = log.spinner();
  sp.start(`Loading ${tag} and measuring speed with a 2k-token prompt (30–90 s on first load)…`);
  try {
    const b = await ctx.client.benchmark(tag);
    ctx.benchmark = b;
    ctx.warmup = {
      tokensPerSec: b.gen_tps,
      evalCount: 0,
      evalDurationMs: 0,
      loadDurationMs: b.load_ms,
      totalDurationMs: 0,
      reply: "",
    };
    const eta = estimateSecondsPerPacket(b);
    const speed =
      b.gen_tps !== null
        ? `${b.gen_tps} tok/s generation, ${b.prompt_tps ?? "?"} tok/s prompt`
        : "speed unknown";
    sp.stop(`${tag} ready: ${log.pc.bold(speed)} (load ${Math.round(b.load_ms / 100) / 10} s)`);
    if (eta !== null) {
      log.info(
        `Expect about ${log.pc.bold(formatMinutes(eta))} per typical packet (4k tokens in, a 2k-token file out). Agents run the executor in the background, one packet at a time.`,
      );
    }
  } catch (err) {
    ctx.warmup = null;
    ctx.benchmark = null;
    sp.error(`Benchmark failed: ${(err as Error).message}`);
    ctx.warnings.push(
      `Speed measurement failed for ${tag}; run \`check_local.mjs --bench\` later. The model may not have loaded (memory pressure?).`,
    );
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
