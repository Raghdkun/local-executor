/**
 * Model catalog and hardware tiers for the local executor.
 *
 * This is a data file on purpose: updating a tag, a size, or a tier boundary
 * should never require touching the recommendation logic in `recommend.ts`.
 *
 * Every tag below was checked against https://ollama.com/library/<family>/tags
 * on the date in `lastVerified`. Sizes are the download sizes shown on those
 * pages, rounded, and are approximate (the on-disk footprint is a little larger
 * and the in-memory footprint grows with `num_ctx`).
 */

export const lastVerified = "2026-09-07";

export type ModelFamily = "qwen3.5" | "qwen3.6" | "qwen3.8" | "gemma4" | "devstral" | "granite4.2";

export interface CatalogModel {
  /** Exact Ollama tag, e.g. `qwen3.5:9b`. */
  tag: string;
  family: ModelFamily;
  /** Human-readable parameter description. */
  params: string;
  /** Approximate download size in GB, from ollama.com. */
  sizeGB: number;
  /** Advertised context window, in thousands of tokens. */
  contextK: number;
  /** One line on what this model is good for. */
  notes: string;
  /** True for tags that only make sense on Apple Silicon (MLX builds). */
  appleOnly?: boolean;
}

export const catalog: readonly CatalogModel[] = [
  {
    tag: "qwen3.5:2b",
    family: "qwen3.5",
    params: "2B dense",
    sizeGB: 2.7,
    contextK: 256,
    notes: "Smallest usable executor; keep packets short and single-file.",
  },
  {
    tag: "gemma4:e2b",
    family: "gemma4",
    params: "2B effective (per-layer embeddings)",
    sizeGB: 7.2,
    contextK: 128,
    notes: "Fast on CPU; larger download than its active size suggests.",
  },
  {
    tag: "qwen3.5:4b",
    family: "qwen3.5",
    params: "4B dense",
    sizeGB: 3.4,
    contextK: 256,
    notes: "Light and fast; good for small, well-specified tasks.",
  },
  {
    tag: "gemma4:e4b",
    family: "gemma4",
    params: "4B effective (per-layer embeddings)",
    sizeGB: 9.6,
    contextK: 128,
    notes: "Solid instruction following; heavier download than qwen3.5:4b.",
  },
  {
    tag: "granite4.2:3b",
    family: "granite4.2",
    params: "3B dense (IBM, Apache-2.0)",
    sizeGB: 2.2,
    contextK: 128,
    notes: "Very small and fast; a mechanical-packet fallback.",
  },
  {
    tag: "granite4.2:8b",
    family: "granite4.2",
    params: "8B dense (IBM, Apache-2.0)",
    sizeGB: 5.3,
    contextK: 128,
    notes: "Newest small dense coder as of 2026-09; alternative to qwen3.5:9b.",
  },
  {
    tag: "qwen3.5:9b",
    family: "qwen3.5",
    params: "9B dense",
    sizeGB: 6.6,
    contextK: 256,
    notes: "Best code quality that fits on a 16 GB machine.",
  },
  {
    tag: "qwen3.5:9b-mlx",
    family: "qwen3.5",
    params: "9B dense, MLX build",
    sizeGB: 8.9,
    contextK: 256,
    notes: "Apple Silicon only; faster than the GGUF build, needs ~2 GB more memory.",
    appleOnly: true,
  },
  {
    tag: "gemma4:12b",
    family: "gemma4",
    params: "12B dense",
    sizeGB: 7.6,
    contextK: 256,
    notes: "Dense 12B; a good middle ground when 9B is not enough.",
  },
  {
    tag: "devstral",
    family: "devstral",
    params: "24B dense (Mistral, agentic coding)",
    sizeGB: 14,
    contextK: 128,
    notes: "Purpose-built for coding; older but well-tested.",
  },
  {
    tag: "qwen3.8:27b",
    family: "qwen3.8",
    params: "27B dense (newest Qwen, 2026-08)",
    sizeGB: 18,
    contextK: 256,
    notes: "Newest Qwen dense model; strongest local coder that fits in 22 GB+.",
  },
  {
    tag: "gemma4:26b",
    family: "gemma4",
    params: "26B MoE (4B active)",
    sizeGB: 19,
    contextK: 256,
    notes: "Strong coding; MoE is fast per token but the whole 26B must fit in memory.",
  },
  {
    tag: "qwen3.6:27b-coding",
    family: "qwen3.6",
    params: "27B dense, coding tune",
    sizeGB: 18,
    contextK: 256,
    notes: "Dense coding tune; slower per token than the 35B MoE but very capable.",
  },
  {
    tag: "gemma4:31b",
    family: "gemma4",
    params: "31B dense",
    sizeGB: 20,
    contextK: 256,
    notes: "Largest Gemma that fits on a 48 GB machine with room for context.",
  },
  {
    tag: "qwen3.6:35b-a3b",
    family: "qwen3.6",
    params: "35B MoE (3B active)",
    sizeGB: 23,
    contextK: 256,
    notes: "Frontier-adjacent local coding; fast per token thanks to 3B active.",
  },
  {
    tag: "qwen3.6:35b-a3b-coding",
    family: "qwen3.6",
    params: "35B MoE (3B active), coding tune",
    sizeGB: 23,
    contextK: 256,
    notes: "Same footprint as qwen3.6:35b-a3b with a coding-specific fine-tune.",
  },
] as const;

export interface Tier {
  /** Inclusive lower bound of effective memory, in GB. */
  minGB: number;
  /** Exclusive upper bound of effective memory, in GB. `Infinity` for the top tier. */
  maxGB: number;
  /** Short label used in tables. */
  label: string;
  recommended: string;
  alsoOffer: readonly string[];
  reason: string;
}

/**
 * Tiers are keyed on "effective memory": the memory the model can realistically
 * use, not the machine's total RAM. See `effectiveMemoryGB()` in `recommend.ts`.
 */
export const tiers: readonly Tier[] = [
  {
    minGB: 0,
    maxGB: 6,
    label: "< 6 GB",
    recommended: "qwen3.5:2b",
    alsoOffer: ["granite4.2:3b", "gemma4:e2b"],
    reason: "Very tight; short packets only",
  },
  {
    minGB: 6,
    maxGB: 10,
    label: "6–10 GB",
    recommended: "qwen3.5:4b",
    alsoOffer: ["granite4.2:8b", "gemma4:e4b"],
    reason: "Light and fast; good for small tasks",
  },
  {
    minGB: 10,
    maxGB: 14,
    label: "10–14 GB",
    recommended: "qwen3.5:9b",
    alsoOffer: ["granite4.2:8b", "gemma4:e4b", "qwen3.5:4b"],
    reason: "Best code quality that fits",
  },
  {
    minGB: 14,
    maxGB: 22,
    label: "14–22 GB",
    recommended: "qwen3.5:9b",
    alsoOffer: ["gemma4:e4b", "qwen3.5:9b-mlx"],
    reason: "9B at Q4 fits with headroom",
  },
  {
    minGB: 22,
    maxGB: 30,
    label: "22–30 GB",
    recommended: "qwen3.8:27b",
    alsoOffer: ["gemma4:26b", "qwen3.5:9b", "devstral"],
    reason: "Newest 27B dense fits; strong coding",
  },
  {
    minGB: 30,
    maxGB: 48,
    label: "30–48 GB",
    recommended: "qwen3.6:35b-a3b",
    alsoOffer: ["qwen3.8:27b", "gemma4:26b", "gemma4:31b"],
    reason: "Frontier-adjacent local coding",
  },
  {
    minGB: 48,
    maxGB: Number.POSITIVE_INFINITY,
    label: "≥ 48 GB",
    recommended: "qwen3.6:35b-a3b",
    alsoOffer: ["gemma4:31b", "qwen3.6:35b-a3b-coding", "qwen3.6:27b-coding"],
    reason: "Room for big context",
  },
] as const;

/** Free disk required to pull a model, as a multiple of its download size. */
export const diskSafetyFactor = 1.5;

/** Below this many physical cores on a CPU-only box we step one tier down. */
export const minCpuOnlyCores = 4;

/** Share of unified memory usable for the model on Apple Silicon. */
export const appleUnifiedMemoryShare = 0.7;

/** Share of system RAM usable for the model on a CPU-only x64 machine. */
export const cpuOnlyRamShare = 0.5;

/** Discrete GPUs reporting less than this are treated as integrated (CPU rule applies). */
export const minDiscreteVramGB = 4;

export function findModel(tag: string): CatalogModel | undefined {
  return catalog.find((m) => m.tag === tag);
}
