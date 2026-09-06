import { join, resolve, sep } from "node:path";
import si from "systeminformation";
import type { GpuInfo, GpuKind, HardwareProfile, Platform } from "./types.js";

/**
 * Everything the detector touches is injected so tests never call
 * systeminformation or read the real environment.
 */
export interface DetectDeps {
  cpu: () => Promise<
    Pick<si.Systeminformation.CpuData, "manufacturer" | "brand" | "cores" | "physicalCores">
  >;
  mem: () => Promise<Pick<si.Systeminformation.MemData, "total" | "available" | "free">>;
  graphics: () => Promise<{
    controllers: Pick<
      si.Systeminformation.GraphicsControllerData,
      "vendor" | "model" | "vram" | "memoryTotal"
    >[];
  }>;
  fsSize: () => Promise<Pick<si.Systeminformation.FsSizeData, "mount" | "available" | "size">[]>;
  platform: NodeJS.Platform;
  arch: string;
  env: NodeJS.ProcessEnv;
  homedir: string;
}

export const defaultDeps = (): DetectDeps => ({
  cpu: () => si.cpu(),
  mem: () => si.mem(),
  graphics: () => si.graphics(),
  fsSize: () => si.fsSize(),
  platform: process.platform,
  arch: process.arch,
  env: process.env,
  homedir: process.env.HOME ?? process.env.USERPROFILE ?? "",
});

const GB = 1024 ** 3;
const round1 = (n: number): number => Math.round(n * 10) / 10;

export function toPlatform(p: NodeJS.Platform): Platform {
  if (p === "darwin" || p === "win32") return p;
  return "linux";
}

/** Where Ollama keeps its model blobs. Honors OLLAMA_MODELS. */
export function ollamaModelsDir(env: NodeJS.ProcessEnv, homedir: string): string {
  if (env.OLLAMA_MODELS) return env.OLLAMA_MODELS;
  return join(homedir, ".ollama", "models");
}

export function classifyGpu(
  controllers: Pick<
    si.Systeminformation.GraphicsControllerData,
    "vendor" | "model" | "vram" | "memoryTotal"
  >[],
  platform: NodeJS.Platform,
  arch: string,
): GpuInfo {
  if (platform === "darwin" && arch === "arm64") {
    const apple = controllers.find((c) => /apple/i.test(`${c.vendor} ${c.model}`));
    return { kind: "apple", model: apple?.model || "Apple Silicon (unified memory)", vramGB: null };
  }
  let best: GpuInfo = { kind: "none", model: "", vramGB: null };
  const rank: Record<GpuKind, number> = { nvidia: 4, amd: 3, apple: 2, intel: 1, none: 0 };
  for (const c of controllers) {
    const text = `${c.vendor} ${c.model}`;
    let kind: GpuKind = "none";
    if (/nvidia/i.test(text)) kind = "nvidia";
    else if (/\b(amd|ati|radeon)\b/i.test(text)) kind = "amd";
    else if (/intel/i.test(text)) kind = "intel";
    else if (/apple/i.test(text)) kind = "apple";
    if (kind === "none") continue;
    const mb = c.memoryTotal ?? c.vram ?? null;
    const vramGB = mb === null ? null : round1(mb / 1024);
    const better =
      rank[kind] > rank[best.kind] ||
      (rank[kind] === rank[best.kind] && (vramGB ?? 0) > (best.vramGB ?? 0));
    if (better) best = { kind, model: c.model || c.vendor, vramGB };
  }
  return best;
}

/**
 * Pick the mounted filesystem that contains `dir`: the longest mount path that
 * is a prefix of it. On Windows this reduces to matching the drive letter.
 */
export function pickVolume<T extends { mount: string }>(
  volumes: T[],
  dir: string,
  platform: NodeJS.Platform,
): T | undefined {
  const norm = (p: string): string => {
    let s = resolve(p);
    if (platform === "win32") s = s.toLowerCase();
    return s.endsWith(sep) ? s : s + sep;
  };
  const target = norm(dir);
  let best: T | undefined;
  let bestLen = -1;
  for (const v of volumes) {
    if (!v.mount) continue;
    const m = norm(v.mount);
    if (target.startsWith(m) && m.length > bestLen) {
      best = v;
      bestLen = m.length;
    }
  }
  return best;
}

export async function detectHardware(deps: DetectDeps = defaultDeps()): Promise<HardwareProfile> {
  const [cpu, mem, gfx, volumes] = await Promise.all([
    deps.cpu().catch(() => ({ manufacturer: "", brand: "unknown", cores: 1, physicalCores: 1 })),
    deps.mem().catch(() => ({ total: 0, available: 0, free: 0 })),
    deps.graphics().catch(() => ({ controllers: [] })),
    deps.fsSize().catch(() => []),
  ]);

  const modelsDir = ollamaModelsDir(deps.env, deps.homedir);
  // Ollama creates the dir on first pull; fall back to home when it doesn't exist yet,
  // which lives on the same volume in every default install.
  const vol =
    pickVolume(volumes, modelsDir, deps.platform) ??
    pickVolume(volumes, deps.homedir, deps.platform);

  const physical = cpu.physicalCores > 0 ? cpu.physicalCores : cpu.cores;
  const cpuModel = [cpu.manufacturer, cpu.brand]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    platform: toPlatform(deps.platform),
    arch: deps.arch,
    cpuModel: cpuModel || "unknown CPU",
    physicalCores: physical,
    logicalCores: cpu.cores,
    totalRamGB: round1(mem.total / GB),
    freeRamGB: round1((mem.available || mem.free) / GB),
    gpu: classifyGpu(gfx.controllers, deps.platform, deps.arch),
    freeDiskGB: round1((vol?.available ?? 0) / GB),
    modelsDir,
  };
}
