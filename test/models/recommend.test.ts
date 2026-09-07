import { describe, expect, it } from "vitest";
import {
  buildRecommendation,
  effectiveMemory,
  recommendModels,
  recommendNumCtx,
  tierFor,
} from "../../src/models/recommend.js";
import { hw, linuxCpuOnly, pcNvidia16 } from "./fixtures.js";

describe("effectiveMemory", () => {
  it("uses 70% of unified memory on Apple Silicon", () => {
    const m = effectiveMemory(hw({ totalRamGB: 16 }));
    expect(m.gb).toBeCloseTo(11.2, 1);
    expect(m.rule).toMatch(/Apple Silicon/);
  });

  it("uses VRAM on a discrete NVIDIA GPU", () => {
    const m = effectiveMemory(pcNvidia16());
    expect(m.gb).toBe(16);
    expect(m.rule).toMatch(/NVIDIA/);
  });

  it("uses 50% of RAM on CPU-only x64", () => {
    const m = effectiveMemory(linuxCpuOnly(32));
    expect(m.gb).toBe(16);
    expect(m.rule).toMatch(/CPU only/);
  });

  it("treats a tiny integrated GPU as CPU-only", () => {
    const m = effectiveMemory(
      linuxCpuOnly(32) && {
        ...linuxCpuOnly(32),
        gpu: { kind: "amd", model: "Radeon Graphics", vramGB: 0.5 },
      },
    );
    expect(m.rule).toMatch(/CPU only/);
  });

  it("uses AMD VRAM when it is a real discrete card", () => {
    const m = effectiveMemory({
      ...linuxCpuOnly(32),
      gpu: { kind: "amd", model: "Radeon RX 7900 XTX", vramGB: 24 },
    });
    expect(m.gb).toBe(24);
    expect(m.rule).toMatch(/AMD/);
  });
});

describe("tierFor", () => {
  it.each([
    [0, "qwen3.5:2b"],
    [5.9, "qwen3.5:2b"],
    [6, "qwen3.5:4b"],
    [9.9, "qwen3.5:4b"],
    [10, "qwen3.5:9b"],
    [13.9, "qwen3.5:9b"],
    [14, "qwen3.5:9b"],
    [21.9, "qwen3.5:9b"],
    [22, "gemma4:26b"],
    [29.9, "gemma4:26b"],
    [30, "qwen3.6:35b-a3b"],
    [47.9, "qwen3.6:35b-a3b"],
    [48, "qwen3.6:35b-a3b"],
    [512, "qwen3.6:35b-a3b"],
  ])("%s GB → %s", (gb, tag) => {
    expect(tierFor(gb).recommended).toBe(tag);
  });
});

describe("recommendModels", () => {
  it("exactly one entry is recommended and it is rank 0", () => {
    const list = recommendModels(hw());
    expect(list.filter((r) => r.recommended)).toHaveLength(1);
    expect(list[0]?.recommended).toBe(true);
    expect(list[0]?.rank).toBe(0);
    for (const [i, r] of list.entries()) {
      expect(r.rank).toBe(i);
      expect(r.reason.length).toBeGreaterThan(0);
    }
  });

  it("16 GB Mac → qwen3.5:9b with gemma4:e4b and qwen3.5:4b offered", () => {
    const list = recommendModels(hw({ totalRamGB: 16 }));
    expect(list[0]?.tag).toBe("qwen3.5:9b");
    expect(list[0]?.reason).toBe("Best code quality that fits");
    expect(list.slice(1, 3).map((r) => r.tag)).toEqual(["gemma4:e4b", "qwen3.5:4b"]);
  });

  it("24 GB Mac (16.8 GB effective) offers the MLX build", () => {
    const list = recommendModels(hw({ totalRamGB: 24 }));
    expect(list[0]?.tag).toBe("qwen3.5:9b");
    expect(list.map((r) => r.tag)).toContain("qwen3.5:9b-mlx");
  });

  it("never offers MLX builds off Apple Silicon", () => {
    const list = recommendModels({
      ...pcNvidia16(),
      gpu: { kind: "nvidia", model: "x", vramGB: 20 },
    });
    expect(list.map((r) => r.tag)).not.toContain("qwen3.5:9b-mlx");
  });

  it("32 GB Mac → gemma4:26b", () => {
    expect(recommendModels(hw({ totalRamGB: 32 }))[0]?.tag).toBe("gemma4:26b");
  });

  it("64 GB Mac → qwen3.6:35b-a3b", () => {
    expect(recommendModels(hw({ totalRamGB: 64 }))[0]?.tag).toBe("qwen3.6:35b-a3b");
  });

  it("128 GB Mac → qwen3.6:35b-a3b with larger tags offered", () => {
    const list = recommendModels(hw({ totalRamGB: 128 }));
    expect(list[0]?.tag).toBe("qwen3.6:35b-a3b");
    expect(list.map((r) => r.tag)).toContain("gemma4:31b");
    expect(list.map((r) => r.tag)).toContain("qwen3.6:27b-coding");
  });

  it("16 GB VRAM PC → qwen3.5:9b", () => {
    expect(recommendModels(pcNvidia16())[0]?.tag).toBe("qwen3.5:9b");
  });

  it("8 GB RAM CPU-only laptop → qwen3.5:2b", () => {
    expect(recommendModels(linuxCpuOnly(8))[0]?.tag).toBe("qwen3.5:2b");
  });

  it("steps down one tier on CPU-only boxes with fewer than 4 physical cores", () => {
    const report = buildRecommendation(linuxCpuOnly(32, 2));
    expect(report.naturalTier.recommended).toBe("qwen3.5:9b");
    expect(report.tier.recommended).toBe("qwen3.5:4b");
    expect(report.adjustments[0]).toMatch(/2 physical cores/);
  });

  it("does not apply the core rule on Apple Silicon", () => {
    const report = buildRecommendation(hw({ physicalCores: 2 }));
    expect(report.tier).toBe(report.naturalTier);
    expect(report.adjustments).toHaveLength(0);
  });

  it("steps down when the recommended model does not fit on disk", () => {
    // 64 GB Mac wants qwen3.6:35b-a3b (23 GB → needs 34.5 GB free). Only 20 GB free.
    const report = buildRecommendation(hw({ totalRamGB: 64, freeDiskGB: 20 }));
    expect(report.naturalTier.recommended).toBe("qwen3.6:35b-a3b");
    expect(report.tier.recommended).toBe("qwen3.5:9b");
    expect(report.adjustments.join("\n")).toMatch(/free disk/);
    expect(report.list[0]?.fitsDisk).toBe(true);
  });

  it("explains when nothing fits on disk", () => {
    const report = buildRecommendation(hw({ freeDiskGB: 1 }));
    expect(report.tier.recommended).toBe("qwen3.5:2b");
    expect(report.adjustments.at(-1)).toMatch(/free some space/i);
    expect(report.list[0]?.fitsDisk).toBe(false);
    expect(report.list[0]?.warnings[0]).toMatch(/free disk/);
  });

  it("warns when a model is larger than effective memory", () => {
    // < 6 GB tier offers gemma4:e2b (7.2 GB download).
    const list = recommendModels(linuxCpuOnly(8));
    const e2b = list.find((r) => r.tag === "gemma4:e2b");
    expect(e2b?.fitsMemory).toBe(false);
    expect(e2b?.warnings.join(" ")).toMatch(/larger than effective memory/);
  });

  it("appends other catalog models that fit, largest first, and hides the rest", () => {
    const list = recommendModels(hw({ totalRamGB: 32 })); // 22.4 GB effective
    const tags = list.map((r) => r.tag);
    expect(tags).not.toContain("qwen3.6:35b-a3b"); // 23 GB does not fit
    const extra = list.filter((r) => r.rank > 2);
    for (let i = 1; i < extra.length; i++) {
      expect(extra[i - 1]?.sizeGB).toBeGreaterThanOrEqual(extra[i]?.sizeGB ?? 0);
    }
  });

  it("includeAll lists non-fitting models last with a reason", () => {
    const list = recommendModels(hw({ totalRamGB: 8 }), { includeAll: true });
    const last = list.at(-1);
    expect(last?.fitsMemory).toBe(false);
    expect(last?.reason).toMatch(/does not fit/);
  });

  it("has sizeGB on every entry for display", () => {
    for (const r of recommendModels(hw())) expect(r.sizeGB).toBeGreaterThan(0);
  });
});

describe("recommendNumCtx", () => {
  it("gives 32k only with clear headroom above the model file", () => {
    expect(recommendNumCtx(11.2, 6.6)).toBe(16384); // 16 GB Mac, qwen3.5:9b
    expect(recommendNumCtx(22.4, 6.6)).toBe(32768); // 32 GB Mac, qwen3.5:9b
    expect(recommendNumCtx(22.4, 19)).toBe(16384); // 32 GB Mac, gemma4:26b
    expect(recommendNumCtx(44.8, 23)).toBe(32768); // 64 GB Mac, qwen3.6:35b-a3b
    expect(recommendNumCtx(11.2, undefined)).toBe(16384);
  });
});
