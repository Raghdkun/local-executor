import { detectHardware } from "../hardware/detect.js";
import type { HardwareProfile } from "../hardware/types.js";
import { buildRecommendation } from "../models/recommend.js";
import * as log from "../util/log.js";
import type { RunContext } from "./context.js";

const gb = (n: number): string => `${Math.round(n * 10) / 10} GB`;

export function hardwareRows(hw: HardwareProfile): [string, string][] {
  const gpu =
    hw.gpu.kind === "apple"
      ? "Apple Silicon (unified memory)"
      : hw.gpu.kind === "none"
        ? "none detected"
        : `${hw.gpu.model}${hw.gpu.vramGB !== null ? ` (${gb(hw.gpu.vramGB)} VRAM)` : ""}`;
  return [
    ["OS", `${hw.platform} (${hw.arch})`],
    ["CPU", `${hw.cpuModel}, ${hw.physicalCores} cores (${hw.logicalCores} threads)`],
    ["RAM", `${gb(hw.totalRamGB)} total, ${gb(hw.freeRamGB)} free`],
    ["GPU", gpu],
    ["Free disk", `${gb(hw.freeDiskGB)} on the volume holding ${hw.modelsDir}`],
  ];
}

export async function stepHardware(ctx: RunContext): Promise<void> {
  log.header(
    "2/6",
    "Hardware",
    "What this machine can run. Effective memory decides the model tier.",
  );
  const sp = log.spinner();
  sp.start("Detecting CPU, memory, GPU, and disk…");
  const hw = await detectHardware();
  sp.stop("Hardware detected.");
  ctx.hw = hw;
  log.table(hardwareRows(hw));

  const report = buildRecommendation(hw);
  ctx.report = report;
  log.info(
    `Effective memory for models: ${log.pc.bold(gb(report.effectiveMemory.gb))} (${report.effectiveMemory.rule}) → tier ${report.tier.label}`,
  );
  for (const a of report.adjustments) log.warn(a);
  const top = report.list[0];
  if (top) log.success(`Recommended: ${log.code(top.tag)} (~${top.sizeGB} GB) — ${top.reason}`);
}
