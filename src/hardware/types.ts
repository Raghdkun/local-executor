export type Platform = "darwin" | "linux" | "win32";
export type GpuKind = "apple" | "nvidia" | "amd" | "intel" | "none";

export interface GpuInfo {
  kind: GpuKind;
  model: string;
  /** Dedicated VRAM in GB, or null when unknown / unified. */
  vramGB: number | null;
}

export interface HardwareProfile {
  platform: Platform;
  arch: string;
  cpuModel: string;
  physicalCores: number;
  logicalCores: number;
  totalRamGB: number;
  freeRamGB: number;
  gpu: GpuInfo;
  /** Free space on the volume that holds Ollama's model store. */
  freeDiskGB: number;
  /** Directory Ollama stores models in (informational). */
  modelsDir: string;
}
