import type { HardwareProfile } from "../hardware/types.js";
import {
  appleUnifiedMemoryShare,
  type CatalogModel,
  catalog,
  cpuOnlyRamShare,
  diskSafetyFactor,
  findModel,
  minCpuOnlyCores,
  minDiscreteVramGB,
  type Tier,
  tiers,
} from "./catalog.js";

export interface Recommendation {
  tag: string;
  /** Approximate download size in GB. */
  sizeGB: number;
  /** Free disk needed to pull this tag safely. */
  diskNeededGB: number;
  fitsDisk: boolean;
  /** Whether the download size fits inside effective memory. */
  fitsMemory: boolean;
  /** Exactly one entry in the list has this set. */
  recommended: boolean;
  /** 0 = top pick. */
  rank: number;
  reason: string;
  warnings: string[];
  model: CatalogModel;
}

export interface EffectiveMemory {
  gb: number;
  /** One-line explanation of which rule produced `gb`. */
  rule: string;
}

export interface RecommendationReport {
  effectiveMemory: EffectiveMemory;
  /** The tier actually used after any step-downs. */
  tier: Tier;
  /** The tier the raw memory number would have selected. */
  naturalTier: Tier;
  /** Human-readable reasons for each step-down applied, in order. */
  adjustments: string[];
  list: Recommendation[];
}

export interface RecommendOptions {
  /** Include catalog models that do not fit in memory (marked, ranked last). */
  includeAll?: boolean;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function isAppleSilicon(hw: HardwareProfile): boolean {
  return hw.platform === "darwin" && hw.arch === "arm64";
}

/**
 * Memory the model can realistically occupy. This is the single number the
 * tiers are keyed on.
 */
export function effectiveMemory(hw: HardwareProfile): EffectiveMemory {
  if (isAppleSilicon(hw) || hw.gpu.kind === "apple") {
    return {
      gb: round1(hw.totalRamGB * appleUnifiedMemoryShare),
      rule: `Apple Silicon: ${Math.round(appleUnifiedMemoryShare * 100)}% of ${round1(hw.totalRamGB)} GB unified memory`,
    };
  }
  const vram = hw.gpu.vramGB ?? 0;
  if ((hw.gpu.kind === "nvidia" || hw.gpu.kind === "amd") && vram >= minDiscreteVramGB) {
    const vendor = hw.gpu.kind === "nvidia" ? "NVIDIA" : "AMD";
    return {
      gb: round1(vram),
      rule: `${vendor} GPU: ${round1(vram)} GB VRAM (${hw.gpu.model})`,
    };
  }
  return {
    gb: round1(hw.totalRamGB * cpuOnlyRamShare),
    rule: `CPU only: ${Math.round(cpuOnlyRamShare * 100)}% of ${round1(hw.totalRamGB)} GB RAM`,
  };
}

export function tierFor(effectiveGB: number): Tier {
  const found = tiers.find((t) => effectiveGB >= t.minGB && effectiveGB < t.maxGB);
  // Tiers cover [0, Infinity); the fallback only guards against negative input.
  return found ?? (tiers[0] as Tier);
}

function tierIndex(tier: Tier): number {
  return tiers.indexOf(tier);
}

function stepDown(tier: Tier): Tier | undefined {
  const i = tierIndex(tier);
  return i > 0 ? tiers[i - 1] : undefined;
}

export function diskNeededGB(model: CatalogModel): number {
  return round1(model.sizeGB * diskSafetyFactor);
}

function isCpuOnly(hw: HardwareProfile): boolean {
  if (isAppleSilicon(hw) || hw.gpu.kind === "apple") return false;
  const vram = hw.gpu.vramGB ?? 0;
  return !((hw.gpu.kind === "nvidia" || hw.gpu.kind === "amd") && vram >= minDiscreteVramGB);
}

/**
 * Full recommendation with the reasoning attached. `recommendModels()` is the
 * thin wrapper that returns just the ranked list.
 */
export function buildRecommendation(
  hw: HardwareProfile,
  opts: RecommendOptions = {},
): RecommendationReport {
  const mem = effectiveMemory(hw);
  const naturalTier = tierFor(mem.gb);
  let tier = naturalTier;
  const adjustments: string[] = [];

  // Rule: weak CPU-only machines step down a tier. Adjacent tiers can share a
  // top pick (10–14 and 14–22 both recommend qwen3.5:9b), so keep stepping
  // until the recommended tag actually gets smaller.
  if (isCpuOnly(hw) && hw.physicalCores < minCpuOnlyCores) {
    const from = tier;
    let lower = stepDown(tier);
    while (lower && lower.recommended === from.recommended) lower = stepDown(lower);
    if (lower) {
      adjustments.push(
        `Stepped down from ${from.recommended} to ${lower.recommended}: only ${hw.physicalCores} physical cores on a CPU-only machine; a larger model would be too slow.`,
      );
      tier = lower;
    }
  }

  // Rule: the recommended tag must fit on disk with a safety margin.
  for (;;) {
    const model = findModel(tier.recommended);
    if (!model) break;
    if (diskNeededGB(model) <= hw.freeDiskGB) break;
    const lower = stepDown(tier);
    if (!lower) {
      adjustments.push(
        `${tier.recommended} needs ${diskNeededGB(model)} GB free disk (download × ${diskSafetyFactor}) and only ${round1(hw.freeDiskGB)} GB is free. Nothing smaller is in the catalog; free some space before pulling.`,
      );
      break;
    }
    adjustments.push(
      `Stepped down from ${tier.recommended} to ${lower.recommended}: ${tier.recommended} needs ${diskNeededGB(model)} GB free disk and only ${round1(hw.freeDiskGB)} GB is free.`,
    );
    tier = lower;
  }

  const apple = isAppleSilicon(hw);
  const seen = new Set<string>();
  const list: Recommendation[] = [];

  const push = (tag: string, reason: string, recommended: boolean): void => {
    const model = findModel(tag);
    if (!model || seen.has(tag)) return;
    if (model.appleOnly && !apple) return;
    seen.add(tag);
    const needed = diskNeededGB(model);
    const fitsDisk = needed <= hw.freeDiskGB;
    const fitsMemory = model.sizeGB <= mem.gb;
    const warnings: string[] = [];
    if (!fitsDisk) {
      warnings.push(`Needs ${needed} GB free disk; ${round1(hw.freeDiskGB)} GB available.`);
    }
    if (!fitsMemory) {
      warnings.push(
        `Download (${model.sizeGB} GB) is larger than effective memory (${mem.gb} GB); expect swapping and very slow output.`,
      );
    }
    list.push({
      tag,
      sizeGB: model.sizeGB,
      diskNeededGB: needed,
      fitsDisk,
      fitsMemory,
      recommended,
      rank: list.length,
      reason,
      warnings,
      model,
    });
  };

  push(tier.recommended, tier.reason, true);
  for (const alt of tier.alsoOffer) {
    const m = findModel(alt);
    push(alt, m?.notes ?? "Alternative for this tier", false);
  }

  // Everything else that fits in memory, largest first, so `lex models` shows
  // the whole viable menu without hiding options behind the tier table.
  const rest = catalog.filter((m) => !seen.has(m.tag));
  const fitting = rest.filter((m) => m.sizeGB <= mem.gb).sort((a, b) => b.sizeGB - a.sizeGB);
  for (const m of fitting) push(m.tag, m.notes, false);
  if (opts.includeAll) {
    const tooBig = rest.filter((m) => m.sizeGB > mem.gb).sort((a, b) => a.sizeGB - b.sizeGB);
    for (const m of tooBig) push(m.tag, `${m.notes} (does not fit in ${mem.gb} GB)`, false);
  }

  return { effectiveMemory: mem, tier, naturalTier, adjustments, list };
}

/**
 * Pure function: hardware in, ranked models out. The top entry has
 * `recommended: true`; every entry carries a one-line `reason`.
 */
export function recommendModels(
  hw: HardwareProfile,
  opts: RecommendOptions = {},
): Recommendation[] {
  return buildRecommendation(hw, opts).list;
}
